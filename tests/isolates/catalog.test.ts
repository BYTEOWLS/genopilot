import assert from 'node:assert/strict';
import test from 'node:test';
import {stringify} from 'yaml';
import {childIsolateIds, IsolateCatalogValidationError, parseIsolateCatalog, suggestIsolateId, suggestLibraryId,
  validateIsolateCatalog, type Isolate} from '../../src/isolates/catalog.js';
import {testReadSet} from '../read-sets.js';

function isolate(id: string, overrides: Partial<Isolate> = {}): Isolate {
  return {id, name: id, wildtype: null, derived_from: null,
    read_sets: [testReadSet([{r1: `/data/${id}_R1.fq`, r2: `/data/${id}_R2.fq`, trimmed: false}])], ...overrides};
}
function catalogOf(...isolates: unknown[]) {return {schema_version: 1, isolates};}
function issuesFor(value: unknown) {
  try {validateIsolateCatalog(value);} catch (error) {
    assert.ok(error instanceof IsolateCatalogValidationError);
    return error.issues;
  }
  assert.fail('expected invalid catalog');
}

test('round-trips multiple file groups, shared libraries, lineage, and unknown processing', () => {
  const first = isolate('a');
  first.read_sets[0]!.read_pairs.push({r1: '/data/a2_R1.fq', r2: '/data/a2_R2.fq', trimmed: true});
  first.read_sets.push(testReadSet([{r1: '/data/a3_R1.fq', r2: '/data/a3_R2.fq', trimmed: null}], {id: 'resequenced'}));
  const catalog = catalogOf(first, isolate('b', {derived_from: 'a'}));
  const parsed = parseIsolateCatalog(stringify(catalog));
  assert.deepEqual(parsed, catalog);
  assert.deepEqual(childIsolateIds(parsed, 'a'), ['b']);
  assert.equal(parsed.isolates[0]!.read_sets[0]!.library_id, parsed.isolates[0]!.read_sets[1]!.library_id);
});

test('accepts empty catalogs and rejects legacy versions without migrating', () => {
  assert.deepEqual(validateIsolateCatalog(catalogOf()), catalogOf());
  assert.match(issuesFor({schema_version: 2, isolates: []})[0]!.message, /re-import/);
  assert.ok(issuesFor({...catalogOf(), extra: true}).some(issue => issue.path === '$.extra'));
  const {read_sets, ...legacy} = isolate('legacy');
  assert.ok(issuesFor(catalogOf({...legacy, read_pairs: read_sets[0]!.read_pairs})).some(issue => issue.path.endsWith('.read_sets')));
});

test('records explicit Illumina detection schemes and rejects the old other category', () => {
  for (const chemistry of ['four-colour', 'two-colour', 'one-channel', 'unknown'] as const) {
    const entry = isolate('sample');
    entry.read_sets[0]!.illumina.chemistry = chemistry;
    const parsed = parseIsolateCatalog(stringify(catalogOf(entry)));
    assert.equal(parsed.isolates[0]!.read_sets[0]!.illumina.chemistry, chemistry);
  }
  const entry = isolate('sample');
  Object.assign(entry.read_sets[0]!.illumina, {chemistry: 'other'});
  assert.ok(issuesFor(catalogOf(entry)).some(issue => issue.path.endsWith('.illumina.chemistry')));
});

test('rejects non-string Illumina settings rather than coercing YAML values', () => {
  for (const field of ['chemistry', 'poly_g'] as const) {
    for (const value of [undefined, null, true, 1, ['two-colour'], ['on'], {value: 'on'}]) {
      const entry = isolate('sample');
      Object.assign(entry.read_sets[0]!.illumina, {[field]: value});
      assert.ok(issuesFor(catalogOf(entry)).some(issue => issue.path.endsWith(`.illumina.${field}`)));
      assert.throws(() => parseIsolateCatalog(stringify(catalogOf(entry))), IsolateCatalogValidationError);
    }
  }
});

test('validates read-set identity, explicit library, platform, layout, and processing', () => {
  for (const change of [{id: 'Bad ID'}, {name: ''}, {library_id: ''}, {platform: 'nanopore'},
    {layout: 'single-end'}, {illumina: {chemistry: 'unknown', poly_g: 'guess'}}, {read_pairs: []}]) {
    const entry = isolate('a');
    Object.assign(entry.read_sets[0]!, change);
    assert.ok(issuesFor(catalogOf(entry)).length > 0);
  }
  const entry = isolate('a');
  entry.read_sets.push(structuredClone(entry.read_sets[0]!));
  assert.ok(issuesFor(catalogOf(entry)).some(issue => issue.path.endsWith('.id')));
  for (const read_sets of [[], undefined]) {
    assert.ok(issuesFor(catalogOf({...isolate('a'), read_sets})).some(issue => issue.path.endsWith('.read_sets')));
  }
});

test('rejects relative paths and repeated files across groups, sets, or isolates', () => {
  for (const path of ['relative.fq', '/data/./a_R1.fq']) {
    const entry = isolate('a');
    entry.read_sets[0]!.read_pairs[0]!.r2 = path;
    assert.ok(issuesFor(catalogOf(entry)).some(issue => issue.path.endsWith('.r2')));
  }
  const entry = isolate('a');
  entry.read_sets.push(testReadSet([{r1: '/data/a_R1.fq', r2: '/data/other.fq', trimmed: false}], {id: 'other'}));
  assert.ok(issuesFor(catalogOf(entry)).some(issue => issue.message.includes('same file')));
  const other = isolate('b');
  other.read_sets[0]!.read_pairs[0]!.r1 = '/data/a_R1.fq';
  assert.ok(issuesFor(catalogOf(isolate('a'), other)).some(issue => issue.message.includes('isolate "a"')));
});

test('requires explicit isolate metadata and validates lineage', () => {
  const {wildtype: omitted, ...entry} = isolate('a');
  assert.ok(issuesFor(catalogOf(entry)).some(issue => issue.path.endsWith('.wildtype')));
  for (const change of [{id: 'Bad ID'}, {name: '  '}, {wildtype: 'yes'}, {derived_from: 'missing'}, {derived_from: 'a'}]) {
    assert.ok(issuesFor(catalogOf({...isolate('a'), ...change})).length > 0);
  }
  assert.ok(issuesFor(catalogOf(isolate('a'), isolate('a'))).some(issue => issue.path.endsWith('.id')));
  assert.ok(issuesFor(catalogOf(isolate('a', {derived_from: 'b'}), isolate('b', {derived_from: 'a'})))
    .every(issue => issue.path.endsWith('.derived_from')));
  assert.doesNotThrow(() => validateIsolateCatalog(catalogOf(isolate('a'), isolate('b', {derived_from: 'a'}), isolate('c', {derived_from: 'b'}))));
});

test('suggests safe, unused library identities without reusing an existing preparation', () => {
  assert.equal(suggestLibraryId('Sample A', []), 'sample-a-library-1');
  assert.equal(suggestLibraryId('Sample A', ['sample-a-library-1', 'sample-a-library-3']), 'sample-a-library-2');
  assert.equal(suggestLibraryId('Café #1', []), 'cafe-1-library-1');
});

test('suggests unique IDs from names', () => {
  assert.equal(suggestIsolateId('Café #1', []), 'cafe-1');
  assert.equal(suggestIsolateId('42 strain', []), 'isolate-42-strain');
  assert.equal(suggestIsolateId('***', []), 'isolate');
  assert.equal(suggestIsolateId('Isolate A', ['isolate-a', 'isolate-a-2']), 'isolate-a-3');
});
