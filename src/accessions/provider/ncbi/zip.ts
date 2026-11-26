import {createReadStream, createWriteStream} from 'node:fs';
import {open, type FileHandle} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createInflateRaw} from 'node:zlib';

export type ZipMember = {name: string; offset: number; compressed: number; size: number; method: number; crc: number};

function uint64(buffer: Buffer, offset: number): number {
  if (offset + 8 > buffer.length) {
    throw new Error('Truncated ZIP64 field.');
  }
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ZIP64 value exceeds the supported file size.');
  }
  return Number(value);
}

async function readExactly(file: FileHandle, length: number, offset: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  if (offset < 0 || (await file.read(buffer, 0, length, offset)).bytesRead !== length) {
    throw new Error('Truncated ZIP record.');
  }
  return buffer;
}

function zip64Extra(extra: Buffer): Buffer | undefined {
  let result: Buffer | undefined;
  let cursor = 0;
  while (cursor < extra.length) {
    if (cursor + 4 > extra.length) {
      throw new Error('Truncated ZIP extra field.');
    }
    const tag = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + length > extra.length) {
      throw new Error('Truncated ZIP extra field.');
    }
    if (tag === 1) {
      if (result) {
        throw new Error('Duplicate ZIP64 extra field.');
      }
      result = extra.subarray(cursor, cursor + length);
    }
    cursor += length;
  }
  return result;
}

/** Read only the central directory; classic and ZIP64 payloads remain streamed. */
export async function zipMembers(path: string): Promise<ZipMember[]> {
  const file = await open(path, 'r');
  try {
    const {size} = await file.stat();
    if (!Number.isSafeInteger(size)) {
      throw new Error('ZIP archive exceeds the supported file size.');
    }
    const tail = await readExactly(file, Math.min(size, 65557), Math.max(0, size - 65557));
    let end = tail.length - 22;
    while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) {
      end -= 1;
    }
    if (end < 0) {
      throw new Error('Invalid ZIP end record.');
    }
    let count = tail.readUInt16LE(end + 10);
    let length = tail.readUInt32LE(end + 12);
    let offset = tail.readUInt32LE(end + 16);
    let directoryEnd = size - tail.length + end;
    if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || tail.readUInt16LE(end + 8) !== count) {
      throw new Error('Multipart ZIP archives are not supported.');
    }
    if (count === 65535 || length === 0xffffffff || offset === 0xffffffff) {
      const locator = await readExactly(file, 20, directoryEnd - 20);
      if (locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
        throw new Error('Invalid or multipart ZIP64 locator.');
      }
      const recordOffset = uint64(locator, 8);
      const record = await readExactly(file, 56, recordOffset);
      if (record.readUInt32LE(0) !== 0x06064b50 || uint64(record, 4) < 44 || recordOffset + 12 + uint64(record, 4) > directoryEnd - 20
        || record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0 || uint64(record, 24) !== uint64(record, 32)) {
        throw new Error('Invalid or multipart ZIP64 end record.');
      }
      count = uint64(record, 32);
      length = uint64(record, 40);
      offset = uint64(record, 48);
      directoryEnd = recordOffset;
    }
    if (length > 64 * 1024 * 1024 || offset + length > directoryEnd || count > Math.floor(length / 46)) {
      throw new Error('Invalid or oversized ZIP directory.');
    }
    const directory = await readExactly(file, length, offset);
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
      const extra = zip64Extra(directory.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
      let extraCursor = 0;
      for (const key of ['size', 'compressed', 'offset'] as const) {
        if (member[key] === 0xffffffff) {
          if (!extra) {
            throw new Error('Missing ZIP64 extra field.');
          }
          member[key] = uint64(extra, extraCursor);
          extraCursor += 8;
        }
      }
      let disk = directory.readUInt16LE(cursor + 34);
      if (disk === 65535) {
        if (!extra || extraCursor + 4 > extra.length) {
          throw new Error('Missing ZIP64 disk field.');
        }
        disk = extra.readUInt32LE(extraCursor);
      }
      if (disk !== 0) {
        throw new Error('Multipart ZIP members are not supported.');
      }
      if (![0, 8].includes(member.method)) {
        throw new Error(`Unsupported ZIP compression method (${member.method}).`);
      }
      if (member.offset + 30 + member.compressed > offset) {
        throw new Error('ZIP member exceeds the archive payload.');
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
    const header = await readExactly(file, 30, member.offset);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== member.method || (header.readUInt16LE(6) & 1) !== 0) {
      throw new Error('Invalid ZIP local header.');
    }
    start = member.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (start + member.compressed > (await file.stat()).size) {
      throw new Error('Truncated ZIP payload.');
    }
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
