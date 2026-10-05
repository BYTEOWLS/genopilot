import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {accessionDisplayName, recordedCacheState, type AccessionEntry} from './catalog.js';
import {verifyFileChecksum as verify} from '../browser/verified-file.js';
import {viewTitle, type GenomeView} from '../browser/contract.js';

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
    title: viewTitle('Accession catalog', `${accessionDisplayName(entry)} · ${entry.accession}`),
    provenance: {application, sources: [
      {label: 'Verified imported reference', path: fasta, sha256: copy.fasta_sha256},
      ...(annotation ? [{label: 'Verified imported annotation', path: annotation, sha256: copy.gff3_sha256}] : []),
    ]},
    content: {kind: 'genome', reference: {name: entry.accession, fasta, snapshot: referenceSnapshot}, tracks: annotation ? [
      {id: 'annotation', name: 'Cached annotation', kind: 'annotation', format: 'gff3', file: annotation, snapshot: annotationSnapshot, shown: true},
    ] : []},
  };
}
