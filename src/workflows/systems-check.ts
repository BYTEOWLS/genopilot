import {statfs} from 'node:fs/promises';
import {availableParallelism, totalmem} from 'node:os';
import {dirname, resolve} from 'node:path';
import {resolveToolingPaths} from '../tooling/paths.js';
import type {MachineDetails} from './configuration-validation.js';
import type {DiskEstimateFactors, WorkflowManifest} from './manifest.js';
import {
  estimateFromRate,
  rateForMachine,
  readMachineRates,
  recordMachineRate,
  type MeasuredEstimate,
} from './machine-rates.js';

/** What a run's start page reports about the machine. */
export type MachineCheck = {
  /** Free space where the run directory will be; absent when it cannot be read. */
  freeBytes?: number;
  availableCpus: number;
  /** Installed, not free: free memory is no guide while the system uses it as a file cache. */
  installedMemoryBytes: number;
};

export type DiskEstimate = {keptBytes: number; peakBytes: number};

/** A workflow's default disk estimate of a run, with a note on what it leaves out. */
export type RunDiskEstimate = {disk: DiskEstimate; note?: string};

/** A workflow's factors by their names; throws when the manifest lacks one or declares another. */
export function namedDiskFactors<const N extends string>(factors: DiskEstimateFactors, names: readonly N[]): Record<N, number> {
  const declared = Object.keys(factors);
  const missing = names.filter(name => !declared.includes(name));
  const unknown = declared.filter(name => !(names as readonly string[]).includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `The workflow's disk_estimate needs exactly ${names.join(', ')}` +
      `${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}${unknown.length > 0 ? `; unknown: ${unknown.join(', ')}` : ''}.`,
    );
  }
  return factors as Record<N, number>;
}

/** The start page's rows, and warnings shown above them. */
export type SystemsCheck = {rows: {label: string; value: string}[]; warnings: string[]};

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
  estimate?: RunDiskEstimate & {measured?: MeasuredEstimate; effectiveCpus?: number},
): SystemsCheck {
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
  // Temporary files are not measured; the default estimate's share stays.
  const disk = measured
    ? {keptBytes: measured.keptBytes, peakBytes: measured.keptBytes + estimate.disk.peakBytes - estimate.disk.keptBytes}
    : estimate.disk;
  const notes = [measured ? `measured on run ${measured.runId}` : '', estimate.note ?? ''].filter(Boolean);
  rows.push({
    label: 'Disk estimate',
    // Without temporary files, the peak is the final size.
    value: (disk.peakBytes > disk.keptBytes
      ? `${formatBytes(disk.keptBytes)} when finished, up to ${formatBytes(disk.peakBytes)} while running`
      : formatBytes(disk.keptBytes)) +
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

/** What a workflow tells the systems check about one prepared run. */
export type SystemsCheckRun = {
  runId: string;
  outputDirectory: string;
  machine: MachineDetails;
  effectiveCpus: number;
  /**
   * The workflow's own estimate from its manifest's factors, whose names and meaning only it knows;
   * a workflow without one shows the machine only.
   */
  diskEstimate?: (factors: DiskEstimateFactors) => Promise<RunDiskEstimate>;
};

/** The fields every workflow's prepared run has. */
type PreparedRun = {
  outputDirectory: string;
  configuration: {run: {id: string}; resources: {machine: MachineDetails; effective_cpus: number}};
};

/** The systems check's view of a prepared run, with the workflow's disk estimate, if it has one. */
export function systemsCheckRun<T extends PreparedRun>(
  prepared: T,
  diskEstimate?: (factors: DiskEstimateFactors, prepared: T) => Promise<RunDiskEstimate>,
): SystemsCheckRun {
  const {resources, run} = prepared.configuration;
  return {
    runId: run.id,
    outputDirectory: prepared.outputDirectory,
    machine: resources.machine,
    effectiveCpus: resources.effective_cpus,
    ...(diskEstimate ? {diskEstimate: factors => diskEstimate(factors, prepared)} : {}),
  };
}

/** Whether a completed run is measured for the next estimates: only with disk factors. */
export function recordsRunRates(manifest: WorkflowManifest | undefined): boolean {
  return manifest?.disk_estimate !== undefined;
}

async function defaultDiskEstimate(
  manifest: WorkflowManifest | undefined,
  run: SystemsCheckRun,
): Promise<RunDiskEstimate | undefined> {
  return manifest?.disk_estimate && run.diskEstimate ? run.diskEstimate(manifest.disk_estimate) : undefined;
}

/**
 * The start page's systems check of any workflow: the machine, and, when the manifest declares
 * disk factors and the workflow estimates from them, the disk estimate and the estimates of a run
 * measured on this machine. A failed estimate is a warning, never a reason to block the run.
 */
export async function checkRunSystem(
  manifest: WorkflowManifest | undefined,
  run: SystemsCheckRun,
  {
    check = checkMachine,
    ratesPath = resolveToolingPaths().machineRatesPath,
  }: {check?: (outputDirectory: string) => Promise<MachineCheck>; ratesPath?: string} = {},
): Promise<SystemsCheck> {
  const machine = await check(run.outputDirectory);
  let estimate;
  try {
    estimate = await defaultDiskEstimate(manifest, run);
  } catch (error) {
    const review = systemsCheckReview(machine);
    review.warnings.push(`No disk estimate: ${error instanceof Error ? error.message : String(error)}`);
    return review;
  }
  if (!manifest || !estimate) {
    return systemsCheckReview(machine);
  }
  const rate = rateForMachine(await readMachineRates(ratesPath), manifest.id, run.machine);
  return systemsCheckReview(machine, {
    ...estimate,
    ...(rate ? {measured: estimateFromRate(rate, estimate.disk.keptBytes), effectiveCpus: run.effectiveCpus} : {}),
  });
}

/**
 * Measures a completed run for the next run's estimates on this machine; a workflow without a
 * disk estimate has nothing to scale from. Resolves to a note when the measurement failed, which
 * only means the next estimate uses the defaults.
 */
export async function recordRunRate(
  manifest: WorkflowManifest | undefined,
  run: SystemsCheckRun,
  ratesPath = resolveToolingPaths().machineRatesPath,
): Promise<string | undefined> {
  try {
    const estimate = await defaultDiskEstimate(manifest, run);
    if (!manifest || !estimate) {
      return undefined;
    }
    await recordMachineRate({
      ratesPath,
      workflowId: manifest.id,
      runId: run.runId,
      runDirectory: run.outputDirectory,
      machine: run.machine,
      effectiveCpus: run.effectiveCpus,
      estimatedBytes: estimate.disk.keptBytes,
    });
    return undefined;
  } catch (error) {
    return `This run was not measured for the next estimate: ${error instanceof Error ? error.message : String(error)}`;
  }
}
