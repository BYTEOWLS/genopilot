import assert from 'node:assert/strict';
import test from 'node:test';
import {stageDurationRows, timingRows} from '../../src/ui/run-timing-rows.js';

const format = (value: string) => `formatted:${value}`;

test('lists start, finish, and duration under the given prefix, and attempts only when there are several', () => {
  const attempt = {startedAt: 'a', finishedAt: 'b', durationMs: 1_000};
  const single = timingRows({startedAt: 's', finishedAt: 'f', durationMs: 61_000, attempts: [attempt]}, 'run', format);
  assert.deepEqual(single.map(row => [row.id, row.value]), [
    ['run.started_at', 'formatted:s'],
    ['run.finished_at', 'formatted:f'],
    ['run.duration', '1 min 1 s'],
  ]);
  const resumed = timingRows({startedAt: 's', finishedAt: 'f', durationMs: 2_000, attempts: [attempt, attempt]}, 'run', format);
  assert.ok(resumed.some(row => row.id === 'run.attempts' && row.value.startsWith('2')));
});

test('leaves out what a partial timing lacks', () => {
  assert.deepEqual(timingRows({durationMs: 5_000}, 'cohort', format).map(row => row.id), ['cohort.duration']);
});

test('names stage durations by the stage, and an unknown stage as the remaining steps', () => {
  const rows = stageDurationRows(
    {stages: [{id: 'align', durationMs: 3_000}, {id: 'unclassified', durationMs: 1_000}]},
    [{id: 'align', label: 'Align reads'}],
    'run',
  );
  assert.deepEqual(rows.map(row => [row.id, row.value]), [['run.stage.align', '3 s'], ['run.stage.unclassified', '1 s']]);
  assert.notEqual(rows[0]!.label, rows[1]!.label);
});
