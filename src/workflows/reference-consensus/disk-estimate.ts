import {stat} from 'node:fs/promises';
import {readPairs} from '../../isolates/catalog.js';
import {join} from 'node:path';
import type {DiskEstimateFactors} from '../manifest.js';
import {ncbiCacheDirectory} from '../run-preparation.js';
import {namedDiskFactors, type DiskEstimate, type RunDiskEstimate} from '../systems-check.js';
import type {PreparedReferenceConsensusRun} from './run-configuration.js';

/** The manifest's factors, per byte of an isolate's read files and of the backbone FASTA. */
export type ReferenceConsensusDiskFactors = {
  /** Kept per byte of an isolate's reads. */
  isolate_read_bytes: number;
  /** Kept per genome byte, for each isolate. */
  isolate_genome_bytes: number;
  /** Kept per genome byte, once per run. */
  run_genome_bytes: number;
  /** Temporary, per byte of the reads of each isolate processed at the same time. */
  temporary_read_bytes: number;
  /** CPUs one isolate's processing uses, which bounds how many run at the same time. */
  cpus_per_isolate: number;
};

/** Checks the manifest's factors: all of them, no others, and at least one CPU per isolate. */
export function referenceConsensusDiskFactors(factors: DiskEstimateFactors): ReferenceConsensusDiskFactors {
  const named = namedDiskFactors(factors, [
    'isolate_read_bytes',
    'isolate_genome_bytes',
    'run_genome_bytes',
    'temporary_read_bytes',
    'cpus_per_isolate',
  ]);
  if (named.cpus_per_isolate < 1) {
    throw new Error("The workflow's disk_estimate needs cpus_per_isolate of at least 1.");
  }
  return named;
}

/** The sizes the disk estimate scales with, known before the run starts. */
export type DiskEstimateInputs = {
  /** Each isolate's read files, summed. */
  isolateReadBytes: readonly number[];
  /** The genome FASTA; absent while it still has to be downloaded. */
  genomeBytes?: number;
  effectiveCpus: number;
};

/**
 * What a run keeps, and its peak while the temporary files of the isolates processed at the same
 * time also exist: the largest isolates, as many as the effective CPUs run at once.
 */
export function estimateDisk(factors: ReferenceConsensusDiskFactors, inputs: DiskEstimateInputs): DiskEstimate {
  const genome = inputs.genomeBytes ?? 0;
  const reads = inputs.isolateReadBytes;
  const keptBytes = reads.reduce((sum, bytes) => sum + factors.isolate_read_bytes * bytes, 0) +
    reads.length * factors.isolate_genome_bytes * genome +
    factors.run_genome_bytes * genome;
  const concurrent = Math.max(1, Math.floor(inputs.effectiveCpus / factors.cpus_per_isolate));
  const largest = [...reads].sort((left, right) => right - left).slice(0, concurrent);
  const temporary = largest.reduce((sum, bytes) => sum + factors.temporary_read_bytes * bytes, 0);
  return {keptBytes: Math.round(keptBytes), peakBytes: Math.round(keptBytes + temporary)};
}

/**
 * The input sizes the disk estimate scales with. A file that cannot be read counts as empty: the
 * inspection reports it. An NCBI backbone counts once it is in the download cache.
 */
export async function diskEstimateInputs(
  prepared: PreparedReferenceConsensusRun,
  fileSize: (path: string) => Promise<number> = async path => (await stat(path)).size,
): Promise<{inputs: DiskEstimateInputs; note?: string}> {
  const size = (path: string) => fileSize(path).catch(() => 0);
  const isolateReadBytes = await Promise.all(prepared.snapshot.isolates.map(async isolate =>
    (await Promise.all(readPairs(isolate).flatMap(pair => [size(pair.r1), size(pair.r2)])))
      .reduce((sum, bytes) => sum + bytes, 0)));
  const {backbone} = prepared.configuration.inputs;
  const effectiveCpus = prepared.configuration.resources.effective_cpus;
  if (backbone.source === 'local') {
    return {inputs: {isolateReadBytes, genomeBytes: await size(backbone.fasta), effectiveCpus}};
  }
  const cached = join(ncbiCacheDirectory(prepared.configuration.run.output_root, backbone.accession), 'genomic.fna');
  const genomeBytes = await fileSize(cached).catch(() => undefined);
  return genomeBytes === undefined
    ? {inputs: {isolateReadBytes, effectiveCpus}, note: 'without the backbone, which is not downloaded yet'}
    : {inputs: {isolateReadBytes, genomeBytes, effectiveCpus}};
}

/** The run's default disk estimate from the manifest's factors. */
export async function referenceConsensusDiskEstimate(
  factors: DiskEstimateFactors,
  prepared: PreparedReferenceConsensusRun,
): Promise<RunDiskEstimate> {
  const {inputs, note} = await diskEstimateInputs(prepared);
  return {disk: estimateDisk(referenceConsensusDiskFactors(factors), inputs), ...(note ? {note} : {})};
}
