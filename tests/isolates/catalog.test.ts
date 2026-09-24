import assert from 'node:assert/strict';
import test from 'node:test';
import {
  childIsolateIds,
  IsolateCatalogValidationError,
  parseIsolateCatalog,
  suggestIsolateId,
  validateIsolateCatalog,
  type Isolate,
} from '../../src/isolates/catalog.js';

function isolate(id: string, overrides: Partial<Isolate> = {}): Isolate {
  return {
    id,
    name: `Isolate ${id}`,
    wildtype: true,
    derived_from: null,
    read_pairs: [{r1: `/data/${id}_R1.fastq.gz`, r2: `/data/${id}_R2.fastq.gz`, trimmed: false}],
    ...overrides,
  };
}

function issuesFor(value: unknown): {path: string; message: string}[] {
  try {
    validateIsolateCatalog(value);
  } catch (error) {
    assert.ok(error instanceof IsolateCatalogValidationError);
    return [...error.issues];
  }
  assert.fail('Expected the catalog to be rejected.');
}

function catalogOf(...isolates: unknown[]): unknown {
  return {schema_version: 1, isolates};
}

test('parses a valid catalog with lineage', () => {
  const catalog = parseIsolateCatalog(`
schema_version: 1
isolates:
  - id: isolate-a
    name: Isolate A
    description: Wild-type laboratory isolate
    wildtype: true
    derived_from: null
    read_pairs:
      - r1: /data/isolate-a_L007_R1.fastq.gz
        r2: /data/isolate-a_L007_R2.fastq.gz
        trimmed: false
      - r1: /data/isolate-a_L008_R1.fastq.gz
        r2: /data/isolate-a_L008_R2.fastq.gz
        trimmed: false
  - id: isolate-b
    name: Isolate B
    wildtype: false
    derived_from: isolate-a
    read_pairs:
      - r1: /data/isolate-b_R1.fastq.gz
        r2: /data/isolate-b_R2.fastq.gz
        trimmed: true
`);

  assert.deepEqual(catalog.isolates.map(entry => entry.id), ['isolate-a', 'isolate-b']);
  assert.equal(catalog.isolates[0]?.read_pairs.length, 2);
  assert.equal(catalog.isolates[1]?.read_pairs[0]?.trimmed, true);
  assert.equal(catalog.isolates[1]?.derived_from, 'isolate-a');
  assert.deepEqual(childIsolateIds(catalog, 'isolate-a'), ['isolate-b']);
});

test('accepts an empty catalog', () => {
  assert.deepEqual(validateIsolateCatalog(catalogOf()), {schema_version: 1, isolates: []});
});

test('rejects unsupported schema versions and unknown fields', () => {
  const issues = issuesFor({schema_version: 2, isolates: [], extra: true});
  assert.ok(issues.some(issue => issue.path === '$.schema_version'));
  assert.ok(issues.some(issue => issue.path === '$.extra'));
  assert.ok(
    issuesFor(catalogOf({...isolate('a'), genomes: []})).some(issue => issue.path === '$.isolates[0].genomes'),
  );
});

test('rejects malformed isolate fields', () => {
  const issues = issuesFor(catalogOf({
    id: 'Bad ID',
    name: '  ',
    description: 3,
    wildtype: 'yes',
    derived_from: 5,
    read_pairs: [{r1: 'relative/R1.fq', r2: '', trimmed: 'no', layout: 'paired-end'}],
  }));
  const paths = new Set(issues.map(issue => issue.path));
  for (const path of [
    '$.isolates[0].id',
    '$.isolates[0].name',
    '$.isolates[0].description',
    '$.isolates[0].wildtype',
    '$.isolates[0].derived_from',
    '$.isolates[0].read_pairs[0].layout',
    '$.isolates[0].read_pairs[0].r1',
    '$.isolates[0].read_pairs[0].r2',
    '$.isolates[0].read_pairs[0].trimmed',
  ]) {
    assert.ok(paths.has(path), `expected an issue at ${path}`);
  }
});

test('requires wildtype to be explicit rather than inferred', () => {
  const {wildtype: _omitted, ...withoutWildtype} = isolate('a');
  assert.ok(issuesFor(catalogOf(withoutWildtype)).some(issue => issue.path === '$.isolates[0].wildtype'));
});

test('requires at least one read pair', () => {
  for (const read_pairs of [[], undefined]) {
    assert.deepEqual(
      issuesFor(catalogOf({...isolate('a'), read_pairs})).map(issue => issue.path),
      ['$.isolates[0].read_pairs'],
    );
  }
});

test('rejects the same file used twice, including unnormalized spellings and across isolates', () => {
  const sameMates = issuesFor(catalogOf(isolate('a', {
    read_pairs: [{r1: '/data/reads.fq', r2: '/data/./reads.fq', trimmed: false}],
  })));
  assert.deepEqual(sameMates.map(issue => issue.path), ['$.isolates[0].read_pairs[0].r2']);

  const acrossPairs = issuesFor(catalogOf(isolate('a', {
    read_pairs: [
      {r1: '/data/L7_R1.fq', r2: '/data/L7_R2.fq', trimmed: false},
      {r1: '/data/L8_R1.fq', r2: '/data/L7_R2.fq', trimmed: false},
    ],
  })));
  assert.deepEqual(acrossPairs.map(issue => issue.path), ['$.isolates[0].read_pairs[1].r2']);

  const acrossIsolates = issuesFor(catalogOf(
    isolate('a'),
    isolate('b', {read_pairs: [{r1: '/data/a_R1.fastq.gz', r2: '/data/b_R2.fq', trimmed: false}]}),
  ));
  assert.deepEqual(acrossIsolates.map(issue => issue.path), ['$.isolates[1].read_pairs[0].r1']);
});

test('rejects mixing trimmed and untrimmed read pairs in one isolate', () => {
  const issues = issuesFor(catalogOf(isolate('a', {
    read_pairs: [
      {r1: '/data/L7_R1.fq', r2: '/data/L7_R2.fq', trimmed: false},
      {r1: '/data/L8_R1.fq', r2: '/data/L8_R2.fq', trimmed: true},
    ],
  })));
  assert.deepEqual(issues.map(issue => issue.path), ['$.isolates[0].read_pairs']);
});

test('rejects duplicate IDs', () => {
  const issues = issuesFor(catalogOf(
    isolate('a'),
    isolate('a', {read_pairs: [{r1: '/data/other_R1.fq', r2: '/data/other_R2.fq', trimmed: false}]}),
  ));
  assert.deepEqual(issues.map(issue => issue.path), ['$.isolates[1].id']);
});

test('rejects self-derived isolates and missing parents', () => {
  assert.deepEqual(
    issuesFor(catalogOf(isolate('a', {derived_from: 'a'}))).map(issue => issue.path),
    ['$.isolates[0].derived_from'],
  );
  assert.deepEqual(
    issuesFor(catalogOf(isolate('a', {derived_from: 'missing'}))).map(issue => issue.path),
    ['$.isolates[0].derived_from'],
  );
});

test('rejects lineage cycles of any length', () => {
  const twoCycle = issuesFor(catalogOf(
    isolate('a', {derived_from: 'b'}),
    isolate('b', {derived_from: 'a'}),
  ));
  assert.equal(twoCycle.length, 2);
  assert.ok(twoCycle.every(issue => issue.path.endsWith('.derived_from')));

  const threeCycle = issuesFor(catalogOf(
    isolate('a', {derived_from: 'c'}),
    isolate('b', {derived_from: 'a'}),
    isolate('c', {derived_from: 'b'}),
    isolate('d', {derived_from: 'a'}),
  ));
  assert.ok(threeCycle.some(issue => issue.path === '$.isolates[0].derived_from'));
  // An isolate that merely descends from a cycle is reported too, since its lineage is unresolvable.
  assert.ok(threeCycle.some(issue => issue.path === '$.isolates[3].derived_from'));
});

test('accepts a long acyclic lineage chain', () => {
  const catalog = validateIsolateCatalog(catalogOf(
    isolate('a'),
    isolate('b', {derived_from: 'a'}),
    isolate('c', {derived_from: 'b'}),
  ));
  assert.equal(catalog.isolates.length, 3);
});

test('suggests unique IDs from names', () => {
  assert.equal(suggestIsolateId('Isolate A', []), 'isolate-a');
  assert.equal(suggestIsolateId('  Café #1 ', []), 'cafe-1');
  assert.equal(suggestIsolateId('42 strain', []), 'isolate-42-strain');
  assert.equal(suggestIsolateId('***', []), 'isolate');
  assert.equal(suggestIsolateId('Isolate A', ['isolate-a', 'isolate-a-2']), 'isolate-a-3');
});
