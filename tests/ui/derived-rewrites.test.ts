import assert from 'node:assert/strict';
import test from 'node:test';
import type {DerivedRewrite} from '../../src/gff3-replace/derived.js';
import type {RewriteRecord} from '../../src/gff3-replace/job.js';
import {rewriteValue} from '../../src/ui/run-results-screen/derived-rewrites.js';

const record = {
  search: 'search-marker',
  replacement: 'replacement-marker',
  regular_expression: false,
  statistics: {replacements: 37, changed_values: {}, ids: {changed: 12, matched_unchanged: 0, unmatched: 0}, aliases_added: 5, dangling_in_source: 0},
} as unknown as RewriteRecord;

test('a rewrite\'s line shows its counts and why it is outdated', () => {
  const current: DerivedRewrite = {name: 'gff3-replace-x', folder: '/run/derived/gff3-replace-x', record, state: 'current'};
  const line = rewriteValue(current);
  for (const part of ['search-marker', 'replacement-marker', '12', '37', '5']) {
    assert.ok(line.includes(part), `${part} in ${line}`);
  }
  assert.ok(rewriteValue({...current, state: 'outdated', reason: 'reason-marker'}).includes('reason-marker'));
});

test('a record without statistics still shows its search and replacement', () => {
  const {statistics: _statistics, ...withoutStatistics} = record;
  const line = rewriteValue({name: 'n', folder: '/f', record: withoutStatistics as RewriteRecord, state: 'current'});
  assert.ok(line.includes('search-marker'));
  assert.doesNotMatch(line, /\d/);
});
