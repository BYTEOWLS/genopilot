import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {fileSnapshot, sameFile, type FileSnapshot} from './fasta-index.js';

/** Bind a recorded checksum to the exact file identity later registered by the server. */
export async function verifyFileChecksum(path: string, expected: string, signal?: AbortSignal): Promise<FileSnapshot> {
  signal?.throwIfAborted();
  const before = await fileSnapshot(path);
  const hash = createHash('sha256');
  await pipeline(createReadStream(path, {signal}), hash, {signal});
  signal?.throwIfAborted();
  if (hash.digest('hex') !== expected || !sameFile(before, await fileSnapshot(path))) {
    throw new Error(`File no longer matches its recorded checksum: ${path}. Verify the source before reopening.`);
  }
  signal?.throwIfAborted();
  return before;
}
