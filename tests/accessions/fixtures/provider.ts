import {appendFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {GenomeProvider} from '../../../src/accessions/provider.js';

/** Independent providers: no NCBI parsing, metadata, credentials, or cache conventions. */
export function syntheticProvider(source: string): GenomeProvider {
  return {
    id: source,
    label: source,
    description: 'Synthetic resolver contract fixture',
    cacheDirectory: `${source}-files`,
    fields: [],
    artifacts: [{kind: 'fasta', label: 'Sequence'}, {kind: 'gff3', label: 'Annotation'}],
    validateReference(id, parameters) {
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)
        || Object.keys(parameters).length !== 1 || !('release' in parameters) || parameters.release !== 'pinned') {
        throw new Error('Expected the pinned synthetic release.');
      }
      return {source, id, parameters: {release: 'pinned'}};
    },
    validateMetadata(metadata) {
      if (metadata !== null) {
        throw new Error('Synthetic metadata must be null.');
      }
    },
    metadataSummary: () => '',
    async resolveExact(id) {
      return this.validateReference(id, {release: 'pinned'});
    },
    async download(reference, kinds, staging, context) {
      context.signal.throwIfAborted();
      await appendFile(process.env.GENOPILOT_TEST_PROVIDER_CALLS!, `${source}\t${reference.id}\t${kinds.join(',')}\n`);
      const files: {fasta?: string; gff3?: string} = {};
      if (kinds.includes('fasta')) {
        files.fasta = 'genomic.fna';
        await writeFile(join(staging, files.fasta), `>${source}\nACGT\n`);
      }
      if (reference.id === 'transfer-failed') {
        throw new Error('Synthetic transfer failure after writing staged bytes.');
      }
      if (kinds.includes('gff3') && reference.id !== 'missing-annotation') {
        files.gff3 = 'genomic.gff';
        await writeFile(join(staging, files.gff3), `##gff-version 3\n${source}\tsynthetic\tgene\t1\t4\t.\t+\t.\tID=gene1\n`);
      }
      return {files, metadata: null, facts: {fixture: source, release: reference.parameters.release},
        annotation: files.gff3 ? 'available' : kinds.includes('gff3') ? 'unavailable' : 'not-requested'};
    },
  };
}
