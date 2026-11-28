import type {AccessionEntry} from '../src/accessions/catalog.js';
import {genomeSelection} from '../src/accessions/selection.js';

export function downloadedNcbiGenome(id: string): AccessionEntry {
  return {
    source: 'ncbi', id, parameters: {}, metadata: null,
    cached_copies: [{path: `/catalog/${id}`, verified_at: '2026-01-01T00:00:00Z',
      fasta_sha256: 'a'.repeat(64), gff3_sha256: 'b'.repeat(64)}],
  };
}

export function ncbiSelection(id: string): string {
  return genomeSelection(downloadedNcbiGenome(id));
}
