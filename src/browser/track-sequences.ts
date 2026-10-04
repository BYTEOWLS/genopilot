import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import type {GenomeTrack} from './contract.js';

/** Read only the header of indexed evidence, not the entire alignment or variant file. */
export async function trackSequences(track: GenomeTrack, signal: AbortSignal): Promise<string[]> {
  const source = createReadStream(track.file, {signal});
  const decoded = source.pipe(createGunzip());
  source.on('error', error => decoded.destroy(error));
  let bytes = Buffer.alloc(0);
  try {
    for await (const chunk of decoded) {
      signal.throwIfAborted();
      bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
      if (bytes.length > 16 * 1024 * 1024) {
        throw new Error('Evidence header exceeds the supported 16 MiB limit.');
      }
      if (track.format === 'vcf') {
        const text = bytes.toString('utf8');
        if (/^#CHROM\t/m.test(text)) {
          return [...text.matchAll(/^##contig=<ID=([^,>]+)/gm)].map(match => match[1]!);
        }
      } else if (bytes.length >= 8) {
        if (bytes.toString('ascii', 0, 4) !== 'BAM\x01') {
          throw new Error('Not a BAM alignment.');
        }
        const textLength = bytes.readInt32LE(4);
        if (textLength < 0) {
          throw new Error('Invalid BAM header.');
        }
        let offset = 8 + textLength;
        if (bytes.length < offset + 4) {
          continue;
        }
        const count = bytes.readInt32LE(offset);
        offset += 4;
        if (count < 0) {
          throw new Error('Invalid BAM sequence count.');
        }
        const names: string[] = [];
        for (let index = 0; index < count; index++) {
          if (bytes.length < offset + 4) {
            break;
          }
          const length = bytes.readInt32LE(offset);
          if (length < 1) {
            throw new Error('Invalid BAM sequence name.');
          }
          if (bytes.length < offset + 8 + length) {
            break;
          }
          names.push(bytes.toString('utf8', offset + 4, offset + 4 + length - 1));
          offset += 8 + length;
        }
        if (names.length === count) {
          return names;
        }
      }
    }
    throw new Error('Evidence file has no complete sequence header.');
  } finally {
    source.destroy();
    decoded.destroy();
  }
}
