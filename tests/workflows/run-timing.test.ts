import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {unclassifiedStageId, type RunEvent} from '../../src/workflows/run-events.js';
import {
  appendExecutionRecord,
  executionTargets,
  formatDuration,
  readExecutionRecords,
  RUN_TIMING_FILENAME,
  runTiming,
  stageSeconds,
  type ExecutionRecord,
} from '../../src/workflows/run-timing.js';

const base = Date.UTC(2026, 9, 21, 8, 0, 0);

function at(seconds: number): string {
  return new Date(base + seconds * 1000).toISOString();
}

const jobStarted = (seconds: number, jobId: number, rule: string): RunEvent =>
  ({type: 'job-started', jobId, rule, timestamp: at(seconds)});
const jobFinished = (seconds: number, jobId: number): RunEvent =>
  ({type: 'job-finished', jobId, timestamp: at(seconds)});

const stages = [
  {id: 'align', rules: ['align_reads']},
  {id: 'vote', rules: ['vote']},
];

function record(start: number, seconds: number, change: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    started_at: at(start),
    finished_at: at(start + seconds),
    duration_seconds: seconds,
    exit_code: 0,
    command: 'snakemake --cores 2',
    stages: {},
    ...change,
  };
}

async function tempDir(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'run-timing-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

test('counts parallel jobs of a stage once, in stage order, and skips the all rule', () => {
  assert.deepEqual(stageSeconds([
    jobStarted(30, 3, 'vote'), jobFinished(32, 3),
    jobStarted(0, 1, 'align_reads'), jobStarted(5, 2, 'align_reads'),
    jobFinished(10, 1), jobFinished(20, 2),
    jobStarted(40, 4, 'unknown_rule'), jobFinished(41, 4),
    jobStarted(42, 5, 'all'), jobFinished(42, 5),
  ], stages, base + 60_000), {align: 20, vote: 2, [unclassifiedStageId]: 1});
});

test('ends a job without a finish at its failure or at the end of the execution', () => {
  assert.deepEqual(stageSeconds([
    jobStarted(0, 1, 'align_reads'), {type: 'job-failed', jobId: 1, logs: [], timestamp: at(7)},
    jobStarted(10, 2, 'vote'),
  ], stages, base + 15_000), {align: 7, vote: 5});
});

test('sums executions, leaving out the time between an interrupted one and its resume', () => {
  const timing = runTiming([
    record(0, 1, {exit_code: 1, stages: {align: 1}}),
    record(3600, 60, {stages: {align: 50, vote: 10}}),
  ]);
  assert.equal(timing?.startedAt, at(0));
  assert.equal(timing?.finishedAt, at(3660));
  assert.equal(timing?.durationMs, 61_000);
  assert.deepEqual(timing?.attempts.map(attempt => attempt.durationMs), [1_000, 60_000]);
  assert.deepEqual(timing?.stages, [{id: 'align', durationMs: 51_000}, {id: 'vote', durationMs: 10_000}]);
  assert.equal(timing?.peakMemoryBytes, undefined);
  assert.equal(runTiming([]), undefined);

  // The highest sampled peak of the executions that have one.
  const sampled = runTiming([record(0, 1, {peak_memory_bytes: 3e9}), record(10, 1), record(20, 1, {peak_memory_bytes: 5e9})]);
  assert.equal(sampled?.peakMemoryBytes, 5e9);
});

test('recognizes an execution by a target named in its command', () => {
  const iteration = record(0, 1, {command: 'snakemake --cores 2 provenance/cohort/iteration-2.json'});
  assert.equal(executionTargets(iteration, 'provenance/cohort/iteration-2.json'), true);
  assert.equal(executionTargets(iteration, 'provenance/cohort/iteration-20.json'), false);
});

test('appends executions to the run\'s timing file and reads them back', async context => {
  const directory = await tempDir(context);
  assert.deepEqual(await readExecutionRecords(directory), []);
  const first = record(0, 90, {stages: {align: 80}, peak_memory_bytes: 2_147_483_648});
  const second = record(100, 5);
  await appendExecutionRecord(directory, first);
  await appendExecutionRecord(directory, second);
  assert.deepEqual(await readExecutionRecords(directory), [first, second]);
  // Strings are quoted, so a YAML 1.1 reader keeps timestamps as text.
  assert.match(await readFile(join(directory, RUN_TIMING_FILENAME), 'utf8'), /started_at: "2026-10-21T08:00:00\.000Z"/);
});

test('skips malformed entries and reads an unparsable file as empty', async context => {
  const directory = await tempDir(context);
  const path = join(directory, RUN_TIMING_FILENAME);
  await writeFile(path, 'executions:\n  - started_at: yesterday\n  - {}\n');
  assert.deepEqual(await readExecutionRecords(directory), []);
  await writeFile(path, 'executions: [unclosed');
  assert.deepEqual(await readExecutionRecords(directory), []);
});

test('formats durations without leading zero units', () => {
  assert.equal(formatDuration(0), '0 s');
  assert.equal(formatDuration(59_400), '59 s');
  assert.equal(formatDuration(61_000), '1 min 1 s');
  assert.equal(formatDuration(3_600_000), '1 h 0 min 0 s');
  assert.equal(formatDuration((26 * 3600 + 3 * 60 + 4) * 1000), '26 h 3 min 4 s');
});
