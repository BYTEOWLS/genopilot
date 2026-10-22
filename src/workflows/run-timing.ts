import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse, stringify} from 'yaml';
import {unclassifiedStageId, type RunEvent} from './run-events.js';

/** Where GenoPilot records the timing of every execution in a run directory. */
export const RUN_TIMING_FILENAME = 'timing.yaml';

/** One Snakemake execution as GenoPilot recorded it when the process ended. */
export type ExecutionRecord = {
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  /** Absent when the process could not be started or was ended by a signal. */
  exit_code?: number;
  /** The exact command; its targets tell a workflow's executions apart. */
  command: string;
  /** Seconds while at least one of a stage's jobs ran, by stage ID; parallel jobs count once. */
  stages: Record<string, number>;
  /** The highest memory Snakemake and its jobs used together, sampled every few seconds. */
  peak_memory_bytes?: number;
};

export type ExecutionAttempt = {startedAt: string; finishedAt: string; durationMs: number};

export type StageDuration = {id: string; durationMs: number};

export type RunTiming = {
  startedAt: string;
  finishedAt: string;
  /** Summed over executions, so time between an interrupted execution and its resume is left out. */
  durationMs: number;
  attempts: readonly ExecutionAttempt[];
  /** Summed over executions, in the order they first appear. */
  stages: readonly StageDuration[];
  /** The highest of the executions' sampled peaks; absent when none was sampled. */
  peakMemoryBytes?: number;
};

type TimingStages = readonly {id: string; rules?: readonly string[]}[];

type Interval = {start: number; end: number};

/** The wall time covered by possibly overlapping intervals. */
function coveredMs(intervals: Interval[]): number {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  let total = 0;
  let current: Interval | undefined;
  for (const interval of sorted) {
    if (current && interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
      continue;
    }
    if (current) {
      total += current.end - current.start;
    }
    current = {...interval};
  }
  return current ? total + current.end - current.start : total;
}

/**
 * Each stage's wall time in seconds, from the events of one execution, in stage order. A job
 * without a finish runs until its failure or the execution's end.
 */
export function stageSeconds(events: readonly RunEvent[], stages: TimingStages, endedAt: number): Record<string, number> {
  const ownerOf = (rule: string): string =>
    stages.find(stage => stage.rules?.includes(rule))?.id ?? unclassifiedStageId;
  const running = new Map<number, {stage: string; start: number}>();
  const intervals = new Map<string, Interval[]>();
  const close = (jobId: number, end: number) => {
    const job = running.get(jobId);
    if (!job) {
      return;
    }
    running.delete(jobId);
    intervals.set(job.stage, [...intervals.get(job.stage) ?? [], {start: job.start, end}]);
  };
  for (const event of events) {
    const at = event.timestamp === undefined ? Number.NaN : Date.parse(event.timestamp);
    if (!Number.isFinite(at)) {
      continue;
    }
    // A Snakefile's `all` rule only names the targets; it does no work of its own.
    if (event.type === 'job-started' && event.rule !== 'all') {
      running.set(event.jobId, {stage: ownerOf(event.rule), start: at});
    } else if (event.type === 'job-finished' || (event.type === 'job-failed' && event.jobId !== undefined)) {
      close(event.jobId as number, at);
    }
  }
  for (const jobId of [...running.keys()]) {
    close(jobId, endedAt);
  }
  const order = [...stages.map(stage => stage.id), unclassifiedStageId];
  return Object.fromEntries(order
    .filter(id => intervals.has(id))
    .map(id => [id, Math.round(coveredMs(intervals.get(id) ?? []) / 1000)]));
}

function isExecutionRecord(value: unknown): value is ExecutionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.started_at === 'string' && Number.isFinite(Date.parse(record.started_at)) &&
    typeof record.finished_at === 'string' && Number.isFinite(Date.parse(record.finished_at)) &&
    typeof record.duration_seconds === 'number' && record.duration_seconds >= 0 &&
    typeof record.command === 'string' &&
    typeof record.stages === 'object' && record.stages !== null &&
    Object.values(record.stages).every(seconds => typeof seconds === 'number') &&
    (record.peak_memory_bytes === undefined || typeof record.peak_memory_bytes === 'number');
}

/** The run's recorded executions; a missing or unreadable file has none, and a malformed entry is skipped. */
export async function readExecutionRecords(runDirectory: string): Promise<ExecutionRecord[]> {
  let parsed: unknown;
  try {
    parsed = parse(await readFile(join(runDirectory, RUN_TIMING_FILENAME), 'utf8'));
  } catch {
    return [];
  }
  const executions = (parsed as {executions?: unknown} | null)?.executions;
  return Array.isArray(executions) ? executions.filter(isExecutionRecord) : [];
}

/** Appends one execution to the run's timing file. */
export async function appendExecutionRecord(runDirectory: string, record: ExecutionRecord): Promise<void> {
  const executions = [...await readExecutionRecords(runDirectory), record];
  await writeFile(
    join(runDirectory, RUN_TIMING_FILENAME),
    stringify({executions}, {defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN'}),
  );
}

/** Whether an execution's command names `target`, a run-relative path, as an argument. */
export function executionTargets(record: ExecutionRecord, target: string): boolean {
  return record.command.split(/\s+/).includes(target);
}

/** Combines executions of one target, such as a run's own attempts; without any there is no timing. */
export function runTiming(records: readonly ExecutionRecord[]): RunTiming | undefined {
  const first = records.at(0);
  const last = records.at(-1);
  if (!first || !last) {
    return undefined;
  }
  const peaks = records.flatMap(record => record.peak_memory_bytes === undefined ? [] : [record.peak_memory_bytes]);
  const stages = new Map<string, number>();
  for (const record of records) {
    for (const [id, seconds] of Object.entries(record.stages)) {
      stages.set(id, (stages.get(id) ?? 0) + seconds * 1000);
    }
  }
  return {
    startedAt: first.started_at,
    finishedAt: last.finished_at,
    durationMs: records.reduce((sum, record) => sum + record.duration_seconds * 1000, 0),
    attempts: records.map(record => ({
      startedAt: record.started_at,
      finishedAt: record.finished_at,
      durationMs: record.duration_seconds * 1000,
    })),
    stages: [...stages].map(([id, durationMs]) => ({id, durationMs})),
    ...(peaks.length > 0 ? {peakMemoryBytes: Math.max(...peaks)} : {}),
  };
}

/** Formats a duration as `1 h 23 min 45 s`, leaving out leading zero units. */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)} h ${String(minutes)} min ${String(seconds)} s`;
  }
  if (minutes > 0) {
    return `${String(minutes)} min ${String(seconds)} s`;
  }
  return `${String(seconds)} s`;
}
