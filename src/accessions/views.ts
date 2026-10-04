import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {accessionDisplayName, recordedCacheState, type AccessionEntry} from './catalog.js';
import {fileSnapshot, sameFile, type FileSnapshot} from '../browser/fasta-index.js';
import type {GenomeView} from '../browser/contract.js';

async function verify(path: string, expected: string, signal?: AbortSignal): Promise<FileSnapshot> {
  signal?.throwIfAborted();
  const before = await fileSnapshot(path);
  const hash = createHash('sha256');
  await pipeline(createReadStream(path, {signal}), hash, {signal});
  signal?.throwIfAborted();
  if (hash.digest('hex') !== expected || !sameFile(before, await fileSnapshot(path))) {
    throw new Error(`Cached file no longer matches its verified checksum: ${path}. Rescan the caches.`);
  }
  signal?.throwIfAborted();
  return before;
}

/** Open only recorded, verified copies; browsing never downloads, converts, or writes them. */
export async function accessionGenomeView(entry: AccessionEntry, application: {name: string; version: string}, signal?: AbortSignal): Promise<GenomeView> {
  signal?.throwIfAborted();
  if (recordedCacheState(entry) !== 'cached') {
    throw new Error('A verified, non-conflicting cached copy is required to view this accession.');
  }
  const copy = entry.cached_copies[0]!;
  const fasta = join(copy.path, 'genomic.fna');
  const annotation = copy.gff3_sha256 ? join(copy.path, 'genomic.gff') : undefined;
  const referenceSnapshot = await verify(fasta, copy.fasta_sha256, signal);
  const annotationSnapshot = annotation && copy.gff3_sha256 ? await verify(annotation, copy.gff3_sha256, signal) : undefined;
  signal?.throwIfAborted();
  return {
    id: createHash('sha256').update(JSON.stringify([entry.accession, copy.path, copy.fasta_sha256, copy.gff3_sha256])).digest('hex'),
    title: `${accessionDisplayName(entry)} · ${entry.accession}`,
    provenance: {application, sources: [
      {label: 'Verified imported reference', path: fasta, sha256: copy.fasta_sha256},
      ...(annotation ? [{label: 'Verified imported annotation', path: annotation, sha256: copy.gff3_sha256}] : []),
    ]},
    content: {kind: 'genome', reference: {name: entry.accession, fasta, snapshot: referenceSnapshot}, tracks: annotation ? [
      {id: 'annotation', name: 'Cached annotation', kind: 'annotation', format: 'gff3', file: annotation, snapshot: annotationSnapshot, shown: true},
    ] : []},
  };
}
