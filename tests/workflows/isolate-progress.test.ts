import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyIsolateEvent,
  initialIsolateProgress,
  perIsolateRules,
  settleIsolateProgress,
  type IsolateProgress,
} from '../../src/workflows/isolate-progress.js';
import type {RunEvent} from '../../src/workflows/run-events.js';

const rules = {read_pair_rules: ['align_pair'], isolate_rules: ['call', 'summarize']};
const isolates = [
  {id: 'iso-a', label: 'Isolate A', readPairs: 2},
  {id: 'iso-b', label: 'Isolate B', readPairs: 1},
];

function fold(events: readonly RunEvent[]): readonly IsolateProgress[] {
  const jobIsolates = new Map<number, string>();
  return events.reduce(
    (state, event) => applyIsolateEvent(state, event, jobIsolates, rules),
    initialIsolateProgress(isolates, rules) as readonly IsolateProgress[],
  );
}

function started(jobId: number, rule: string, isolate?: string): RunEvent {
  return {type: 'job-started', jobId, rule, wildcards: isolate ? {isolate} : {}};
}

test('expects each read-pair rule once per pair and each isolate rule once', () => {
  assert.deepEqual(
    initialIsolateProgress(isolates, rules).map(isolate => [isolate.id, isolate.state, isolate.total]),
    [['iso-a', 'pending', 4], ['iso-b', 'pending', 3]],
  );
});

test('shows no isolates for a workflow without a per-isolate split', () => {
  assert.equal(perIsolateRules([{}, {}]), undefined);
  assert.deepEqual(initialIsolateProgress(isolates, undefined), []);
  assert.deepEqual(perIsolateRules([{}, {per_isolate: rules}]), rules);
});

test('follows jobs to their isolate until every expected job has finished', () => {
  const running = fold([started(1, 'align_pair', 'iso-b'), started(2, 'index_backbone')]);
  assert.deepEqual(running.map(isolate => [isolate.state, isolate.currentRule, isolate.done]), [
    ['pending', undefined, 0],
    ['running', 'align_pair', 0],
  ]);

  const finished = fold([
    started(1, 'align_pair', 'iso-b'),
    {type: 'job-finished', jobId: 1},
    started(3, 'call', 'iso-b'),
    {type: 'job-finished', jobId: 3},
    started(4, 'summarize', 'iso-b'),
    {type: 'job-finished', jobId: 4},
  ]);
  const isolateB = finished.find(isolate => isolate.id === 'iso-b');
  assert.equal(isolateB?.state, 'completed');
  assert.equal(isolateB?.done, 3);
  assert.equal(isolateB?.currentRule, undefined);
});

test('marks only the isolate whose job failed and keeps it failed', () => {
  const progress = fold([
    started(1, 'align_pair', 'iso-a'),
    started(2, 'align_pair', 'iso-b'),
    {type: 'job-failed', jobId: 1, logs: []},
    {type: 'job-finished', jobId: 2},
    started(5, 'call', 'iso-a'),
  ]);
  assert.deepEqual(progress.map(isolate => isolate.state), ['failed', 'running']);
});

test('ignores jobs of unknown isolates and rules outside the split', () => {
  const progress = fold([started(1, 'align_pair', 'someone-else'), started(2, 'other_rule', 'iso-a')]);
  assert.deepEqual(progress.map(isolate => isolate.state), ['pending', 'pending']);
});

test('a successful run completes every isolate that did not fail, including reused ones', () => {
  const settled = settleIsolateProgress(fold([
    started(1, 'align_pair', 'iso-a'),
    {type: 'job-failed', jobId: 1, logs: []},
  ]));
  assert.deepEqual(settled.map(isolate => [isolate.state, isolate.done]), [['failed', 0], ['completed', 0]]);
});
