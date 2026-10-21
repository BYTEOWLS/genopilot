import {statfs} from 'node:fs/promises';
import {availableParallelism, totalmem} from 'node:os';
import {dirname, resolve} from 'node:path';
import type {DiskEstimateFactors} from './manifest.js';
import type {MeasuredEstimate} from './machine-rates.js';

/** What a run's start page reports about the machine. */
export type MachineCheck = {
  /** Free space where the run directory will be; absent when it cannot be read. */
  freeBytes?: number;
  availableCpus: number;
  /** Installed, not free: free memory is no guide while the system uses it as a file cache. */
  installedMemoryBytes: number;
};

/** The sizes a disk estimate scales with, known before the run starts. */
export type DiskEstimateInputs = {
  /** Each isolate's read files, summed. */
  isolateReadBytes: readonly number[];
  /** The genome FASTA; absent while it still has to be downloaded. */
  genomeBytes?: number;
  effectiveCpus: number;
};

export type DiskEstimate = {keptBytes: number; peakBytes: number};

/** Free space of the nearest existing directory of `path`, which need not exist yet. */
async function freeBytes(path: string, readStatfs: typeof statfs): Promise<number | undefined> {
  let current = resolve(path);
  for (;;) {
    try {
      const stats = await readStatfs(current);
      return stats.bavail * stats.bsize;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }
}

export async function checkMachine(
  outputDirectory: string,
  {
    readStatfs = statfs,
    cpus = availableParallelism,
    installedMemory = totalmem,
  }: {readStatfs?: typeof statfs; cpus?: () => number; installedMemory?: () => number} = {},
): Promise<MachineCheck> {
  const free = await freeBytes(outputDirectory, readStatfs);
  return {...(free === undefined ? {} : {freeBytes: free}), availableCpus: cpus(), installedMemoryBytes: installedMemory()};
}

/**
 * What a run keeps, and its peak while the temporary files of the isolates processed at the same
 * time also exist: the largest isolates, as many as the effective CPUs run at once.
 */
export function estimateDisk(factors: DiskEstimateFactors, inputs: DiskEstimateInputs): DiskEstimate {
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
 * Formats memory in binary gigabytes, as the operating system reports it: 64 GB is 64 × 2³⁰
 * bytes. Below 10 GB with one decimal, so a small peak is not shown as 0 GB.
 */
export function formatMemory(bytes: number): string {
  const gigabytes = bytes / 2 ** 30;
  return `${gigabytes < 10 ? gigabytes.toFixed(1) : String(Math.round(gigabytes))} GB`;
}

/** Formats disk sizes in decimal units, as file browsers and `df -H` show them. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit] ?? 'B'}`;
}

/** A rough duration for an estimate: whole minutes, or hours and minutes. */
export function formatRoughDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${String(minutes)} min` : `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

/**
 * The start page's rows, with warnings when the estimated peak disk need exceeds the free space or
 * a measured run's peak memory exceeds the installed memory. It never blocks the run: the
 * researcher decides. A run measured on this machine replaces the default disk estimate and adds
 * a duration and memory estimate.
 */
export function systemsCheckReview(
  machine: MachineCheck,
  estimate?: {disk: DiskEstimate; note?: string; measured?: MeasuredEstimate; effectiveCpus?: number},
): {rows: {label: string; value: string}[]; warnings: string[]} {
  const rows = [
    {label: 'Free disk', value: machine.freeBytes === undefined ? 'Unknown' : formatBytes(machine.freeBytes)},
    {label: 'Available CPUs', value: String(machine.availableCpus)},
    {label: 'Installed memory', value: formatMemory(machine.installedMemoryBytes)},
  ];
  const warnings: string[] = [];
  if (!estimate) {
    return {rows, warnings};
  }
  const {measured} = estimate;
  // The temporary files of the isolates processed at once are not measured; the manifest's factor stays.
  const disk = measured
    ? {keptBytes: measured.keptBytes, peakBytes: measured.keptBytes + estimate.disk.peakBytes - estimate.disk.keptBytes}
    : estimate.disk;
  const notes = [measured ? `measured on run ${measured.runId}` : '', estimate.note ?? ''].filter(Boolean);
  rows.push({
    label: 'Disk estimate',
    value: `${formatBytes(disk.keptBytes)} kept, up to ${formatBytes(disk.peakBytes)} while running` +
      (notes.length > 0 ? ` (${notes.join('; ')})` : ''),
  });
  if (machine.freeBytes !== undefined && disk.peakBytes > machine.freeBytes) {
    warnings.push(
      `The run may need up to ${formatBytes(disk.peakBytes)}, but only ${formatBytes(machine.freeBytes)} ` +
      'are free where it will be saved. Free some space or choose another output folder; the estimate is a rough guide.',
    );
  }
  if (measured) {
    const cpus = estimate.effectiveCpus !== undefined && estimate.effectiveCpus !== measured.effectiveCpus
      ? `, which used ${String(measured.effectiveCpus)} CPUs; this run uses ${String(estimate.effectiveCpus)}`
      : `, with ${String(measured.effectiveCpus)} CPUs`;
    rows.push({
      label: 'Estimated duration',
      value: `${formatRoughDuration(measured.durationSeconds.low)} to ${formatRoughDuration(measured.durationSeconds.high)}` +
        ` (from run ${measured.runId}${cpus})`,
    });
    if (measured.peakMemoryBytes !== undefined) {
      rows.push({label: 'Expected peak memory', value: `about ${formatMemory(measured.peakMemoryBytes)} (run ${measured.runId})`});
      if (measured.peakMemoryBytes > machine.installedMemoryBytes) {
        warnings.push(
          `Run ${measured.runId} needed about ${formatMemory(measured.peakMemoryBytes)} of memory, more than the ` +
          `${formatMemory(machine.installedMemoryBytes)} installed; a run of this size may be slow or fail.`,
        );
      }
    }
  }
  return {rows, warnings};
}
