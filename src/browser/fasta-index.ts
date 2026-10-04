import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import type {GenomeSequence} from './contract.js';

export type FileSnapshot = {path: string; size: number; mtimeMs: number; ino: number; dev: number};
export async function fileSnapshot(path: string): Promise<FileSnapshot> {
  const details = await stat(path);
  if (!details.isFile() || !Number.isSafeInteger(details.size)) {
    throw new Error(`Not a readable regular file: ${path}`);
  }
  return {path, size: details.size, mtimeMs: details.mtimeMs, ino: details.ino, dev: details.dev};
}
export function sameFile(a: FileSnapshot, b: FileSnapshot): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev;
}

// Retain at most one line, not the entire reference. Concatenate once per line, including
// unwrapped sequences that cross many stream chunks; repeated concatenation would be quadratic.
async function* lines(path: string, signal?: AbortSignal): AsyncGenerator<{line: Buffer; bytes: number}> {
  let pieces: Buffer[] = [];
  let size = 0;
  for await (const chunk of createReadStream(path, {signal})) {
    const buffer = chunk as Buffer;
    let start = 0;
    while (start < buffer.length) {
      const newline = buffer.indexOf(10, start);
      const end = newline < 0 ? buffer.length : newline;
      const piece = buffer.subarray(start, end);
      pieces.push(piece);
      size += piece.length;
      if (newline < 0) {
        break;
      }
      const line = Buffer.concat(pieces, size);
      yield {line: line.at(-1) === 13 ? line.subarray(0, -1) : line, bytes: size + 1};
      pieces = [];
      size = 0;
      start = newline + 1;
    }
  }
  if (size > 0) {
    yield {line: Buffer.concat(pieces, size), bytes: size};
  }
}

type Index = {bytes: Buffer; sequences: GenomeSequence[]; snapshot: FileSnapshot; indexSnapshot?: FileSnapshot};
export class FastaIndexes {
  private readonly cache = new Map<string, Index>();

  async read(path: string, indexPath?: string, signal?: AbortSignal): Promise<Index> {
    signal?.throwIfAborted();
    const snapshot = await fileSnapshot(path);
    if (indexPath) {
      const indexSnapshot = await fileSnapshot(indexPath);
      const bytes = await readFile(indexPath, {signal});
      const sequences: GenomeSequence[] = [];
      const names = new Set<string>();
      const rows: string[] = [];
      for (const line of bytes.toString('utf8').trim().split(/\r?\n/)) {
        const fields = line.split('\t');
        const [name, length, offset, bases, width] = fields;
        const numbers = [length, offset, bases, width].map(Number);
        if (fields.length !== 5 || !name || names.has(name) || numbers.some(value => !Number.isSafeInteger(value) || value < 0) ||
            !numbers[0] || !numbers[2] || numbers[3]! < numbers[2]! || numbers[1]! >= snapshot.size) {
          throw new Error(`Invalid FASTA index: ${indexPath}`);
        }
        const lastBase = numbers[1]! + Math.floor((numbers[0]! - 1) / numbers[2]!) * numbers[3]! + (numbers[0]! - 1) % numbers[2]!;
        if (!Number.isSafeInteger(lastBase) || lastBase >= snapshot.size) {
          throw new Error(`FASTA index extends beyond the reference: ${indexPath}`);
        }
        names.add(name);
        sequences.push({name, length: numbers[0]!});
        rows.push([name, ...numbers].join('\t'));
      }
      // Bounds alone cannot establish index compatibility: an in-range offset
      // can point at a header or another sequence. Compare every row with the
      // actual FASTA layout, reusing the generated index cache on later opens.
      const expected = await this.read(path, undefined, signal);
      const expectedRows = new Set(expected.bytes.toString('utf8').trim().split('\n'));
      if (rows.length !== expectedRows.size || rows.some(row => !expectedRows.has(row))) {
        throw new Error(`FASTA index does not match the reference: ${indexPath}`);
      }
      signal?.throwIfAborted();
      if (!sameFile(snapshot, expected.snapshot) || !sameFile(indexSnapshot, await fileSnapshot(indexPath)) || !sameFile(snapshot, await fileSnapshot(path))) {
        throw new Error(`Reference or index changed while opening: ${path}`);
      }
      return {bytes, sequences, snapshot, indexSnapshot};
    }
    const cached = this.cache.get(path);
    if (cached && sameFile(cached.snapshot, snapshot)) {
      return cached;
    }
    const rows: string[] = [];
    const sequences: GenomeSequence[] = [];
    const names = new Set<string>();
    let position = 0;
    let current: {name: string; length: number; offset: number; bases: number; width: number; previousBases: number; previousWidth: number} | undefined;
    const finish = (): void => {
      if (!current) {
        return;
      }
      if (current.length === 0) {
        throw new Error(`Empty FASTA sequence ${current.name}: ${path}`);
      }
      rows.push(`${current.name}\t${current.length}\t${current.offset}\t${current.bases}\t${current.width}\n`);
      sequences.push({name: current.name, length: current.length});
    };
    for await (const {line, bytes} of lines(path, signal)) {
      const text = line.toString('utf8');
      if (text.startsWith('>')) {
        finish();
        const name = text.slice(1).split(/\s/)[0]!;
        if (!name || names.has(name)) {
          throw new Error(`Missing or duplicate FASTA sequence name: ${path}`);
        }
        names.add(name);
        current = {name, length: 0, offset: position + bytes, bases: 0, width: 0, previousBases: 0, previousWidth: 0};
      } else {
        if (!current || !/^[ACGTRYSWKMBDHVNacgtryswkmbdhvn]+$/.test(text)) {
          throw new Error(`Invalid FASTA sequence line at byte ${position}: ${path}`);
        }
        if (current.length > 0 && (current.previousBases !== current.bases || current.previousWidth !== current.width)) {
          throw new Error(`Inconsistent FASTA line wrapping: ${path}`);
        }
        if (current.length === 0) {
          current.bases = line.length;
          current.width = bytes;
        } else if (line.length > current.bases) {
          throw new Error(`Inconsistent FASTA line wrapping: ${path}`);
        }
        current.length += line.length;
        current.previousBases = line.length;
        current.previousWidth = bytes;
      }
      position += bytes;
    }
    finish();
    if (sequences.length === 0) {
      throw new Error(`No FASTA sequences: ${path}`);
    }
    if (!sameFile(snapshot, await fileSnapshot(path))) {
      throw new Error(`FASTA changed while indexing: ${path}`);
    }
    const index = {bytes: Buffer.from(rows.join('')), sequences, snapshot};
    this.cache.set(path, index);
    return index;
  }

  clear(): void {
    this.cache.clear();
  }
}
