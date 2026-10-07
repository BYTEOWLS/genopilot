import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  applyRunEvent,
  initialRunProgress,
  readAppendedRunEvents,
  RunEventReader,
  RUN_EVENT_SCHEMA_VERSION,
  toRunEvent,
  unclassifiedStageId,
  type RunEvent,
  type RunProgress,
} from '../../src/workflows/run-events.js';

const stages = [
  {id: 'resolve-inputs', label: 'Resolve inputs', rules: ['resolve_reference', 'resolve_target']},
  {id: 'validate-inputs', label: 'Validate inputs', rules: ['validate_inputs']},
  {id: 'summarize-results', label: 'Summarize results'},
];

function line(event: Record<string, unknown>): string {
  return `${JSON.stringify({schema_version: RUN_EVENT_SCHEMA_VERSION, ...event})}\n`;
}

function fold(events: readonly RunEvent[], from = initialRunProgress(stages)): RunProgress {
  const jobStages = new Map<number, string>();
  return events.reduce((state, event) => applyRunEvent(state, event, jobStages, stages), from);
}

test('reads events across chunk boundaries and skips unusable lines', () => {
  const reader = new RunEventReader();

  assert.deepEqual(reader.append('{"schema_version":1,"type":"progr'), []);
  assert.deepEqual(reader.append('ess","done":1,"total":3}\n'), [
    {type: 'progress', done: 1, total: 3},
  ]);
  // A newer producer of the same schema may add types and fields this reader does not know;
  // a different schema version is refused outright rather than reinterpreted.
  assert.deepEqual(
    reader.append(
      '\nnot json\n' +
        line({type: 'progress', done: 2, total: 3, unknown_field: 'ignored'}) +
        line({type: 'future-event'}) +
        JSON.stringify({schema_version: 99, type: 'progress', done: 3, total: 3}) +
        '\n',
    ),
    [{type: 'progress', done: 2, total: 3}],
  );
});

test('rejects events missing the fields that identify them', () => {
  assert.equal(toRunEvent({schema_version: 1, type: 'job-started', rule: 'validate_inputs'}), undefined);
  assert.equal(toRunEvent({schema_version: 1, type: 'job-finished'}), undefined);
  assert.equal(toRunEvent({schema_version: 1, type: 'progress', done: 1}), undefined);
  assert.equal(toRunEvent(['not an object']), undefined);
  assert.deepEqual(toRunEvent({schema_version: 1, type: 'job-finished', job_id: 0}), {
    type: 'job-finished',
    jobId: 0,
  });
});

test('derives a run-info total from per-rule counts when it is absent', () => {
  assert.deepEqual(toRunEvent({schema_version: 1, type: 'run-info', jobs: {a: 2, b: 3}}), {
    type: 'run-info',
    jobs: {a: 2, b: 3},
    total: 5,
  });
});

test('starts every stage pending, up to date, or unimplemented', () => {
  const initial = initialRunProgress(stages);
  assert.deepEqual(
    initial.stages.map(stage => stage.state),
    ['pending', 'pending', 'not-implemented'],
  );
  assert.equal(initial.planned, false);

  // resolve-inputs is scheduled; validate-inputs is not, so its artifacts already exist.
  const planned = fold([{type: 'run-info', jobs: {resolve_reference: 1, resolve_target: 1}, total: 2}]);
  assert.deepEqual(
    planned.stages.map(stage => [stage.id, stage.state, stage.total]),
    [
      ['resolve-inputs', 'pending', 2],
      ['validate-inputs', 'up-to-date', 0],
      // A stage without rules stays unimplemented; it is never reported as up to date.
      ['summarize-results', 'not-implemented', 0],
    ],
  );
  assert.equal(planned.planned, true);
});

test('follows a stage from pending through running to completed', () => {
  const progress = fold([
    {type: 'run-info', jobs: {resolve_reference: 1, resolve_target: 1, validate_inputs: 1}, total: 3},
    {type: 'job-started', jobId: 1, rule: 'resolve_reference'},
    {type: 'job-finished', jobId: 1},
    {type: 'progress', done: 1, total: 3},
    {type: 'job-started', jobId: 2, rule: 'resolve_target'},
    {type: 'job-finished', jobId: 2},
    {type: 'job-started', jobId: 0, rule: 'validate_inputs'},
  ]);

  assert.deepEqual(
    progress.stages.map(stage => [stage.id, stage.state, `${String(stage.done)}/${String(stage.total)}`]),
    [
      ['resolve-inputs', 'completed', '2/2'],
      ['validate-inputs', 'running', '0/1'],
      ['summarize-results', 'not-implemented', '0/0'],
    ],
  );
  assert.equal(progress.done, 1);
  assert.equal(progress.total, 3);
});

test('marks the owning stage failed and keeps the reported reason', () => {
  const progress = fold([
    {type: 'run-info', jobs: {validate_inputs: 1}, total: 1},
    {type: 'job-started', jobId: 0, rule: 'validate_inputs'},
    {type: 'job-failed', jobId: 0, rule: 'validate_inputs', logs: ['logs/validate-inputs.log']},
    {type: 'job-finished', jobId: 0},
  ]);

  const stage = progress.stages.find(candidate => candidate.id === 'validate-inputs');
  // A later job-finished for the same job must not undo the failure.
  assert.equal(stage?.state, 'failed');
  assert.equal(progress.failureMessage, 'Rule validate_inputs failed.');
});

test('keeps a workflow error without a job when no stage owns it', () => {
  const progress = fold([{type: 'error', exception: 'WorkflowError', message: 'Missing input files'}]);

  assert.equal(progress.failureMessage, 'Missing input files');
  assert.deepEqual(
    progress.stages.map(stage => stage.state),
    ['pending', 'pending', 'not-implemented'],
  );
});

test('groups rules the manifest does not classify instead of hiding them', () => {
  // `all` is the Snakefile's own aggregation target, which no presentation stage claims.
  const progress = fold([
    {type: 'run-info', jobs: {validate_inputs: 1, all: 1}, total: 2},
    {type: 'job-started', jobId: 3, rule: 'all'},
    {type: 'job-finished', jobId: 3},
  ]);

  const unclassified = progress.stages.find(stage => stage.id === unclassifiedStageId);
  assert.equal(unclassified?.state, 'completed');
  assert.equal(unclassified?.done, 1);
});

test('reads only what an event file has gained since the previous read', async context => {
  const tempDir = await mkdtemp(join(tmpdir(), 'run-events-test-'));
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const path = join(tempDir, 'events.jsonl');
  const reader = new RunEventReader();

  // The file does not exist until Snakemake starts writing it.
  assert.deepEqual(await readAppendedRunEvents(path, 0, reader), {events: [], offset: 0});

  await writeFile(path, line({type: 'progress', done: 1, total: 2}));
  const first = await readAppendedRunEvents(path, 0, reader);
  assert.deepEqual(first.events, [{type: 'progress', done: 1, total: 2}]);

  assert.deepEqual(await readAppendedRunEvents(path, first.offset, reader), {
    events: [],
    offset: first.offset,
  });

  await writeFile(path, line({type: 'progress', done: 2, total: 2}), {flag: 'a'});
  const second = await readAppendedRunEvents(path, first.offset, reader);
  assert.deepEqual(second.events, [{type: 'progress', done: 2, total: 2}]);
  assert.ok(second.offset > first.offset);
});
