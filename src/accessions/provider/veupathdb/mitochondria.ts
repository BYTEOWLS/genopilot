import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {artifactFiles, type ArtifactPaths} from '../../provider.js';

// Explicit organellar names only; short/unknown contigs are never guessed from size.
function mitochondrial(value: string): boolean {
  return /(?:^|[\s_|:;=-])(?:mito|mitochondrion|mitochondrial|mitochondria|chrM)(?=$|[\s_|:;=-])/i.test(value);
}

async function* lines(path: string, signal: AbortSignal): AsyncGenerator<string> {
  const stream = createReadStream(path, {signal});
  const reader = createInterface({input: stream, crlfDelay: Infinity});
  try {
    for await (const line of reader) {
      signal.throwIfAborted();
      yield line;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function digest(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, {signal})) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** Derive the genomic pair in staging; retain byte-identical provider files as evidence. */
export async function filterMitochondria(directory: string, files: ArtifactPaths, signal: AbortSignal) {
  signal.throwIfAborted();
  const excluded = new Map<string, number>();
  if (files.gff3) {
    for await (const line of lines(join(directory, files.gff3), signal)) {
      if (line.startsWith('##FASTA')) {
        throw new Error('Mitochondrial filtering does not support embedded GFF3 FASTA. No files were published.');
      }
      if (line.startsWith('#')) {
        continue;
      }
      const columns = line.split('\t');
      if (columns.length === 9 && (mitochondrial(columns[0]!)
        || (columns[2] === 'region' && /(?:^|;)(?:genome|organelle)=mitochondrion(?:;|$)/i.test(columns[8]!)))) {
        excluded.set(columns[0]!, 0);
      }
    }
  }
  if (files.fasta) {
    let id = '';
    for await (const line of lines(join(directory, files.fasta), signal)) {
      if (line.startsWith('>')) {
        id = line.slice(1).split(/\s/)[0]!;
        if (mitochondrial(line.slice(1))) {
          excluded.set(id, 0);
        }
      } else if (excluded.has(id)) {
        excluded.set(id, excluded.get(id)! + line.trim().length);
      }
    }
  }
  const originals: Record<string, {path: string; sha256: string}> = {};
  let removedFeatures = 0;
  await mkdir(join(directory, 'original'), {recursive: true});
  for (const kind of ['fasta', 'gff3'] as const) {
    if (!files[kind]) {
      continue;
    }
    const filename = artifactFiles[kind];
    const path = join(directory, filename);
    const original = join(directory, 'original', filename);
    await rename(path, original);
    originals[kind] = {path: `original/${filename}`, sha256: await digest(original, signal)};
    async function* filtered(): AsyncGenerator<string> {
      let omit = false;
      let retainedSequences = 0;
      for await (const line of lines(original, signal)) {
        if (kind === 'fasta') {
          if (line.startsWith('>')) {
            omit = excluded.has(line.slice(1).split(/\s/)[0]!);
            if (!omit) {
              retainedSequences++;
            }
          }
          if (!omit) {
            yield `${line}\n`;
          }
        } else {
          const region = /^##sequence-region\s+(\S+)/.exec(line);
          if (region && excluded.has(region[1]!)) {
            continue;
          }
          if (!line.startsWith('#') && excluded.has(line.split('\t')[0]!)) {
            removedFeatures++;
            continue;
          }
          yield `${line}\n`;
        }
      }
      if (kind === 'fasta' && retainedSequences === 0) {
        throw new Error('Mitochondrial filtering would leave no genome sequences. No files were published.');
      }
    }
    await pipeline(Readable.from(filtered()), createWriteStream(path, {flags: 'wx', mode: 0o600}), {signal});
  }
  return {
    policy: 'exclude-explicit-mitochondrial-v1',
    excluded_sequences: [...excluded].map(([id, bases]) => ({id, bases: files.fasta ? bases : null})),
    removed_features: removedFeatures,
    originals,
    scope: 'genomic FASTA and GFF3 only; other artifacts are unmodified whole-genome files',
    unclassified_sequences: 'retained; absence of an explicit mitochondrial label is not proof of nuclear origin',
  };
}
