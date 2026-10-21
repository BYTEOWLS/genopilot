import {lstat, readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse, stringify} from 'yaml';
import type {MachineDetails} from './configuration-validation.js';
import {readExecutionRecords, runTiming} from './run-timing.js';

/**
 * What one completed run measured on this machine, which the next run's estimates scale from. The
 * run's default estimate is the yardstick: a run twice as large by the manifest's factors is
 * expected to keep twice the bytes and take about twice as long.
 */
export type MachineRate = {
  machine: MachineDetails;
  run: {id: string; directory: string};
  effective_cpus: number;
  /** What the manifest's factors estimated this run would keep. */
  estimated_bytes: number;
  /** What its run directory measured once it completed. */
  kept_bytes: number;
  /**
   * The time its jobs ran, summed over its stages: Conda environments that Snakemake creates
   * before the first job, as on a machine's first run, are left out.
   */
  duration_seconds: number;
  peak_memory_bytes?: number;
};

export type MachineRates = Record<string, MachineRate>;

/** The ratio a duration estimate may be off, either way, shown as its range. */
export const DURATION_RANGE = {low: 0.7, high: 1.5} as const;

function isMachineRate(value: unknown): value is MachineRate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rate = value as Record<string, unknown>;
  const numbers = ['effective_cpus', 'estimated_bytes', 'kept_bytes', 'duration_seconds'];
  return typeof rate.machine === 'object' && rate.machine !== null &&
    typeof rate.run === 'object' && rate.run !== null &&
    typeof (rate.run as Record<string, unknown>).id === 'string' &&
    numbers.every(field => typeof rate[field] === 'number' && (rate[field] as number) >= 0) &&
    (rate.estimated_bytes as number) > 0 &&
    (rate.peak_memory_bytes === undefined || typeof rate.peak_memory_bytes === 'number');
}

/** The stored rates; a missing or unreadable file has none, and a malformed entry is skipped. */
export async function readMachineRates(path: string): Promise<MachineRates> {
  let parsed: unknown;
  try {
    parsed = parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(parsed).filter(([, rate]) => isMachineRate(rate))) as MachineRates;
}

/** Replaces a workflow's rate with the latest completed run's. */
export async function writeMachineRate(path: string, workflowId: string, rate: MachineRate): Promise<void> {
  const rates = {...await readMachineRates(path), [workflowId]: rate};
  await writeFile(path, stringify(rates, {defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN'}));
}

/** The bytes of every file under a directory; links are not followed. */
export async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(path);
    } else if (entry.isFile()) {
      total += (await lstat(path)).size;
    }
  }
  return total;
}

function sameMachine(left: MachineDetails, right: MachineDetails): boolean {
  return left.platform === right.platform && left.architecture === right.architecture &&
    left.cpu_model === right.cpu_model && left.cpus === right.cpus && left.memory_bytes === right.memory_bytes;
}

/** The workflow's rate, only when it was measured on this machine. */
export function rateForMachine(rates: MachineRates, workflowId: string, machine: MachineDetails): MachineRate | undefined {
  const rate = rates[workflowId];
  return rate && sameMachine(rate.machine, machine) ? rate : undefined;
}

export type MeasuredEstimate = {
  runId: string;
  keptBytes: number;
  durationSeconds: {low: number; high: number};
  /** The source run's CPUs, to flag a run with a different count. */
  effectiveCpus: number;
  peakMemoryBytes?: number;
};

/** Scales a measured run to a new one by their default estimates. */
export function estimateFromRate(rate: MachineRate, estimatedBytes: number): MeasuredEstimate {
  const scale = estimatedBytes / rate.estimated_bytes;
  const duration = rate.duration_seconds * scale;
  return {
    runId: rate.run.id,
    keptBytes: Math.round(rate.kept_bytes * scale),
    durationSeconds: {low: duration * DURATION_RANGE.low, high: duration * DURATION_RANGE.high},
    effectiveCpus: rate.effective_cpus,
    ...(rate.peak_memory_bytes === undefined ? {} : {peakMemoryBytes: rate.peak_memory_bytes}),
  };
}

/**
 * Measures a completed run and stores it as the workflow's rate on this machine: its directory's
 * size, and the time its jobs ran and its peak memory as GenoPilot recorded them in `timing.yaml`.
 */
export async function recordMachineRate({
  ratesPath,
  workflowId,
  runId,
  runDirectory,
  machine,
  effectiveCpus,
  estimatedBytes,
}: {
  ratesPath: string;
  workflowId: string;
  runId: string;
  runDirectory: string;
  machine: MachineDetails;
  effectiveCpus: number;
  estimatedBytes: number;
}): Promise<void> {
  const timing = runTiming(await readExecutionRecords(runDirectory));
  const jobSeconds = Math.round((timing?.stages ?? []).reduce((sum, stage) => sum + stage.durationMs, 0) / 1000);
  // Without job times there is nothing to scale from.
  if (!timing || jobSeconds === 0 || estimatedBytes <= 0) {
    return;
  }
  await writeMachineRate(ratesPath, workflowId, {
    machine,
    run: {id: runId, directory: runDirectory},
    effective_cpus: effectiveCpus,
    estimated_bytes: estimatedBytes,
    kept_bytes: await directoryBytes(runDirectory),
    duration_seconds: jobSeconds,
    ...(timing.peakMemoryBytes === undefined ? {} : {peak_memory_bytes: timing.peakMemoryBytes}),
  });
}
