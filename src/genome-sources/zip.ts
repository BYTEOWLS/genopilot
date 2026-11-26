import {createReadStream, createWriteStream} from 'node:fs';
import {open} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createInflateRaw} from 'node:zlib';

export type ZipMember = {name: string; offset: number; compressed: number; size: number; method: number; crc: number};

/** Read only the central directory; genome payloads are streamed, not held in memory. */
export async function zipMembers(path: string): Promise<ZipMember[]> {
  const file = await open(path, 'r');
  try {
    const {size} = await file.stat();
    const tail = Buffer.alloc(Math.min(size, 65557));
    await file.read(tail, 0, tail.length, size - tail.length);
    let end = tail.length - 22;
    while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) {
      end -= 1;
    }
    if (end < 0) {
      throw new Error('Invalid ZIP end record.');
    }
    const count = tail.readUInt16LE(end + 10);
    const length = tail.readUInt32LE(end + 12);
    const offset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || count === 65535 || length === 0xffffffff || offset === 0xffffffff || length > 64 * 1024 * 1024 || offset + length > size) {
      throw new Error('Unsupported ZIP64, multipart, or oversized ZIP directory.');
    }
    const directory = Buffer.alloc(length);
    const read = await file.read(directory, 0, length, offset);
    if (read.bytesRead !== length) {
      throw new Error('Truncated ZIP directory.');
    }
    const members: ZipMember[] = [];
    let cursor = 0;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > length || directory.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('Invalid ZIP directory member.');
      }
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > length || (directory.readUInt16LE(cursor + 8) & 1) !== 0) {
        throw new Error('Truncated or encrypted ZIP member.');
      }
      const member = {
        name: directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
        offset: directory.readUInt32LE(cursor + 42),
        compressed: directory.readUInt32LE(cursor + 20),
        size: directory.readUInt32LE(cursor + 24),
        method: directory.readUInt16LE(cursor + 10),
        crc: directory.readUInt32LE(cursor + 16),
      };
      if ([member.offset, member.compressed, member.size].includes(0xffffffff) || ![0, 8].includes(member.method)) {
        throw new Error('Unsupported ZIP member encoding.');
      }
      members.push(member);
      cursor = next;
    }
    return members;
  } finally {
    await file.close();
  }
}

const crcTable = Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

/** The caller chooses a fixed destination, never a path from an archive. */
export async function extractZipMember(archive: string, member: ZipMember, destination: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const file = await open(archive, 'r');
  let start: number;
  try {
    const header = Buffer.alloc(30);
    const {bytesRead} = await file.read(header, 0, 30, member.offset);
    if (bytesRead !== 30 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== member.method) {
      throw new Error('Invalid ZIP local header.');
    }
    start = member.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await file.close();
  }
  let bytes = 0;
  let crc = 0xffffffff;
  const verify = new Transform({transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > member.size) {
      callback(new Error('ZIP member exceeds its declared size.'));
      return;
    }
    for (const byte of chunk) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
    }
    callback(null, chunk);
  }});
  if (member.compressed === 0) {
    throw new Error('Empty ZIP genome member.');
  }
  const input = createReadStream(archive, {start, end: start + member.compressed - 1});
  const output = createWriteStream(destination, {flags: 'wx', mode: 0o600});
  if (member.method === 8) {
    await pipeline(input, createInflateRaw(), verify, output, {signal});
  } else {
    await pipeline(input, verify, output, {signal});
  }
  if (bytes !== member.size || ((crc ^ 0xffffffff) >>> 0) !== member.crc) {
    throw new Error('ZIP member failed size or CRC verification.');
  }
}
