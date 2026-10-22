import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {DiskEstimateFactors} from '../manifest.js';
import {ncbiCacheDirectory} from '../run-preparation.js';
import {namedDiskFactors, type RunDiskEstimate} from '../systems-check.js';
import type {PreparedAnnotationTransferRun} from './run-configuration.js';

/**
 * The run's default disk estimate: each input's bytes times its manifest factor. No step declares
 * temporary files, so the peak is what the run keeps. A local file that cannot be read counts as
 * empty: the validation reports it. An NCBI input counts once it is in the download cache.
 */
export async function annotationTransferDiskEstimate(
  factors: DiskEstimateFactors,
  prepared: PreparedAnnotationTransferRun,
  fileSize: (path: string) => Promise<number> = async path => (await stat(path)).size,
): Promise<RunDiskEstimate> {
  const named = namedDiskFactors(factors, ['target_genome_bytes', 'reference_genome_bytes', 'reference_annotation_bytes']);
  const {inputs, run} = prepared.configuration;
  const notDownloaded: string[] = [];
  const size = async (
    input: 'reference' | 'target',
    file: 'fasta' | 'gff3',
  ): Promise<number> => {
    const configured = inputs[input];
    if (configured.source === 'local') {
      const path = file === 'fasta' ? configured.fasta : 'gff3' in configured ? configured.gff3 : undefined;
      return path ? fileSize(path).catch(() => 0) : 0;
    }
    const cached = join(ncbiCacheDirectory(run.output_root, configured.accession), file === 'fasta' ? 'genomic.fna' : 'genomic.gff');
    return fileSize(cached).catch(() => {
      if (!notDownloaded.includes(input)) {
        notDownloaded.push(input);
      }
      return 0;
    });
  };
  const [target, referenceGenome, referenceAnnotation] = await Promise.all([
    size('target', 'fasta'),
    size('reference', 'fasta'),
    size('reference', 'gff3'),
  ]);
  const keptBytes = Math.round(
    named.target_genome_bytes * target +
    named.reference_genome_bytes * referenceGenome +
    named.reference_annotation_bytes * referenceAnnotation,
  );
  const missing = ['reference', 'target'].filter(input => notDownloaded.includes(input));
  return {
    disk: {keptBytes, peakBytes: keptBytes},
    ...(missing.length > 0
      ? {note: `without the ${missing.join(' and ')}, ${missing.length > 1 ? 'which are' : 'which is'} not downloaded yet`}
      : {}),
  };
}
