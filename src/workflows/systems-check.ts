import {statfs} from 'node:fs/promises';
import {availableParallelism, totalmem} from 'node:os';
import {dirname, resolve} from 'node:path';
import type {DiskEstimateFactors} from './manifest.js';

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

/** Formats installed memory in binary gigabytes, as the operating system reports it: 64 GB is 64 × 2³⁰ bytes. */
export function formatMemory(bytes: number): string {
  return `${String(Math.round(bytes / 2 ** 30))} GB`;
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

/**
 * The start page's rows and, when the estimated peak exceeds the free space, a warning with both
 * numbers. It never blocks the run: the researcher decides.
 */
export function systemsCheckReview(
  machine: MachineCheck,
  estimate?: {disk: DiskEstimate; note?: string},
): {rows: {label: string; value: string}[]; warnings: string[]} {
  const rows = [
    {label: 'Free disk', value: machine.freeBytes === undefined ? 'Unknown' : formatBytes(machine.freeBytes)},
    {label: 'Available CPUs', value: String(machine.availableCpus)},
    {label: 'Installed memory', value: formatMemory(machine.installedMemoryBytes)},
  ];
  const warnings: string[] = [];
  if (estimate) {
    rows.push({
      label: 'Disk estimate',
      value: `${formatBytes(estimate.disk.keptBytes)} kept, up to ${formatBytes(estimate.disk.peakBytes)} while running` +
        (estimate.note ? ` (${estimate.note})` : ''),
    });
    if (machine.freeBytes !== undefined && estimate.disk.peakBytes > machine.freeBytes) {
      warnings.push(
        `The run may need up to ${formatBytes(estimate.disk.peakBytes)}, but only ${formatBytes(machine.freeBytes)} ` +
        'are free where it will be saved. Free some space or choose another output folder; the estimate is a rough guide.',
      );
    }
  }
  return {rows, warnings};
}
