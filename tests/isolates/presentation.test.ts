import assert from 'node:assert/strict';
import test from 'node:test';
import type {Isolate} from '../../src/isolates/catalog.js';
import {isolateListLineage, lineage, readPairsLabel, readSummary} from '../../src/isolates/presentation.js';
import {testReadSet} from '../read-sets.js';

function isolate(wildtype: Isolate['wildtype'], derived_from: string | null = null): Isolate {
  return {id: 'sample', name: 'Sample', wildtype, derived_from,
    read_sets: [testReadSet([{r1: '/reads/r1.fq', r2: '/reads/r2.fq', trimmed: false}])]};
}

test('successful read checks add no status badge, but pending and failed checks remain visible', () => {
  const entry = isolate(null);
  const summary = readPairsLabel(entry);
  assert.equal(readSummary(entry, {pairs: [{r1: {state: 'ok'}, r2: {state: 'ok'}}], sameFiles: []}), summary);
  assert.ok(readSummary(entry, undefined).length > summary.length);
  assert.ok(readSummary(entry, {
    pairs: [{r1: {state: 'missing', reason: 'missing fixture input'}, r2: {state: 'ok'}}], sameFiles: [],
  }).length > summary.length);
  assert.ok(readSummary(entry, {pairs: [], sameFiles: [{first: '/reads/r1.fq', second: '/reads/r2.fq'}]}).length > summary.length);
});

test('the isolate list only badges a positive wild-type flag', () => {
  assert.ok(isolateListLineage(isolate(true)).length > 0);
  for (const status of [false, null]) {
    assert.equal(isolateListLineage(isolate(status)), '');
    // Full run-review metadata is unchanged.
    assert.ok(lineage(isolate(status)).length > 0);
  }
});

test('parent lineage remains visible without a negative or unknown wild-type badge', () => {
  const parent = 'parent-isolate';
  const withParent = isolateListLineage(isolate(false, parent));
  assert.ok(withParent.includes(parent));
  assert.equal(isolateListLineage(isolate(null, parent)), withParent);
  assert.ok(isolateListLineage(isolate(true, parent)).length > withParent.length);
});
