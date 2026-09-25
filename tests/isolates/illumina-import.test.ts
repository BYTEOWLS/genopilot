import assert from 'node:assert/strict';
import test from 'node:test';
import {validateIsolateCatalog, type Isolate, type IsolateCatalog} from '../../src/isolates/catalog.js';
import type {DeliveryReadSet, DeliveryScan, DeliveryVariant} from '../../src/isolates/illumina-delivery.js';
import {
  applyImportDecisions,
  chooseVariant,
  ImportDecisionError,
  initialDecisions,
  initialReadSetDecision,
  type CandidateDecision,
} from '../../src/isolates/illumina-import.js';

function variant(folder: string, sample: string, suggestedTrimmed = false): DeliveryVariant {
  return {
    r1: `/delivery/${folder}/${sample}_S1_L001_R1_001.fastq.gz`,
    r2: `/delivery/${folder}/${sample}_S1_L001_R2_001.fastq.gz`,
    r1Bytes: 100,
    r2Bytes: 100,
    sampleNumber: 1,
    readLength: suggestedTrimmed ? {min: 50, max: 151} : {min: 151, max: 151},
    sampledReads: 1000,
    suggestedTrimmed,
  };
}

function readSet(variants: DeliveryVariant[], lane: number | null = 1, run = 7): DeliveryReadSet {
  return {instrument: 'A00001', run, flowcell: 'HFLOWAAXX', lane, variants};
}

function scanOf(...candidates: DeliveryScan['candidates']): DeliveryScan {
  return {root: '/delivery', candidates, alreadyImported: [], skippedFiles: [], skippedDirectories: []};
}

function isolate(id: string, overrides: Partial<Isolate> = {}): Isolate {
  return {
    id,
    name: id,
    wildtype: null,
    derived_from: null,
    read_pairs: [{r1: `/data/${id}_R1.fq`, r2: `/data/${id}_R2.fq`, trimmed: false}],
    ...overrides,
  };
}

function catalogOf(...isolates: Isolate[]): IsolateCatalog {
  return {schema_version: 1, isolates};
}

test('preselects a copy only when one untrimmed copy stands out', () => {
  assert.deepEqual(initialReadSetDecision(readSet([variant('raw', 'a')])), {variant: 0, trimmed: false});
  // The only copy is used even when it looks trimmed, with the flag set accordingly.
  assert.deepEqual(initialReadSetDecision(readSet([variant('processed', 'a', true)])), {variant: 0, trimmed: true});
  assert.deepEqual(
    initialReadSetDecision(readSet([variant('processed', 'a', true), variant('raw', 'a')])),
    {variant: 1, trimmed: false},
  );
  for (const variants of [
    [variant('raw', 'a'), variant('copy', 'a')],
    [variant('processed', 'a', true), variant('adapter-trimmed-raw', 'a', true)],
  ]) {
    assert.deepEqual(initialReadSetDecision(readSet(variants)), {variant: 'undecided', trimmed: false});
  }
});

test('choosing a copy resets its trimmed flag to that copy\'s suggestion', () => {
  const set = readSet([variant('raw', 'a'), variant('processed', 'a', true)]);
  assert.deepEqual(chooseVariant(set, 1), {variant: 1, trimmed: true});
  assert.deepEqual(chooseVariant(set, 0), {variant: 0, trimmed: false});
  assert.deepEqual(chooseVariant(set, 'none'), {variant: 'none', trimmed: false});
});

test('proposes adding to an existing isolate with the sample\'s name or ID, and unique new IDs', () => {
  const scan = scanOf(
    {sample: 'known', readSets: [readSet([variant('run-9', 'known')])]},
    {sample: 'Known Name', readSets: [readSet([variant('run-9', 'Known Name')])]},
    {sample: 'strain x', readSets: [readSet([variant('run-9', 'strain x')])]},
    {sample: 'strain-x', readSets: [readSet([variant('run-9', 'strain-x')])]},
    {sample: 'taken', readSets: [readSet([variant('run-9', 'taken')])]},
  );
  const catalog = catalogOf(isolate('known'), isolate('other', {name: 'Known Name'}), isolate('taken-id', {name: 'Taken'}));

  const decisions = initialDecisions(scan, catalog);

  assert.deepEqual(decisions.map(decision => decision.target), [
    {existingId: 'known'},
    {existingId: 'other'},
    'new',
    'new',
    'new',
  ]);
  assert.deepEqual(decisions.slice(2).map(decision => decision.newIsolate.id), ['strain-x', 'strain-x-2', 'taken']);
  assert.deepEqual(decisions[2]?.newIsolate, {name: 'strain x', id: 'strain-x', wildtype: null, derivedFrom: null});
});

test('creates new isolates and extends existing ones in one catalog', () => {
  const scan = scanOf(
    {sample: 'new-one', readSets: [readSet([variant('raw', 'new-one'), variant('processed', 'new-one', true)])]},
    {sample: 'known', readSets: [readSet([variant('run-9', 'known')], 1, 9), readSet([variant('run-9', 'known')], 2, 9)]},
    {sample: 'ignored', readSets: [readSet([variant('raw', 'ignored')])]},
  );
  const catalog = catalogOf(isolate('known'));
  const decisions: CandidateDecision[] = initialDecisions(scan, catalog);
  decisions[0] = {...decisions[0]!, newIsolate: {name: 'New One', id: 'new-one', wildtype: true, derivedFrom: 'known'}};
  // Leave lane 2 of the top-up out and skip the third sample entirely.
  decisions[1] = {...decisions[1]!, readSets: [decisions[1]!.readSets[0]!, {variant: 'none', trimmed: false}]};
  decisions[2] = {...decisions[2]!, target: 'skip'};

  const result = applyImportDecisions(catalog, scan, decisions);

  assert.equal(result.created, 1);
  assert.equal(result.extended, 1);
  assert.deepEqual(result.catalog.isolates.map(entry => [entry.id, entry.read_pairs.length]), [['known', 2], ['new-one', 1]]);
  assert.deepEqual(result.catalog.isolates[1], {
    id: 'new-one',
    name: 'New One',
    wildtype: true,
    derived_from: 'known',
    read_pairs: [{r1: '/delivery/raw/new-one_S1_L001_R1_001.fastq.gz', r2: '/delivery/raw/new-one_S1_L001_R2_001.fastq.gz', trimmed: false}],
  });
  assert.equal(result.pairs.length, 2);
  assert.doesNotThrow(() => validateIsolateCatalog(result.catalog));
  // The input catalog is left unchanged.
  assert.equal(catalog.isolates[0]?.read_pairs.length, 1);
});

test('refuses open choices, empty selections, and vanished targets', () => {
  const scan = scanOf(
    {sample: 'open', readSets: [readSet([variant('raw', 'open'), variant('copy', 'open')])]},
    {sample: 'empty', readSets: [readSet([variant('raw', 'empty')])]},
    {sample: 'gone', readSets: [readSet([variant('raw', 'gone')])]},
  );
  const decisions: CandidateDecision[] = initialDecisions(scan, catalogOf());
  decisions[1] = {...decisions[1]!, readSets: [{variant: 'none', trimmed: false}]};
  decisions[2] = {...decisions[2]!, target: {existingId: 'gone'}};

  assert.throws(() => applyImportDecisions(catalogOf(), scan, decisions), (error: unknown) => {
    assert.ok(error instanceof ImportDecisionError);
    assert.equal(error.problems.length, 4);
    // Problems name the sample as the review numbers it.
    assert.ok(error.problems[0]?.startsWith('1) open:'));
    assert.ok(error.problems[2]?.startsWith('2) empty:'));
    assert.ok(error.problems[3]?.startsWith('3) gone:'));
    return true;
  });
});

test('counts an existing isolate once when several samples add to it', () => {
  const scan = scanOf(
    {sample: 'known', readSets: [readSet([variant('run-9', 'known')], 1, 9)]},
    {sample: 'known-topup', readSets: [readSet([variant('run-11', 'known-topup')], 1, 11)]},
  );
  const catalog = catalogOf(isolate('known'));
  const decisions = initialDecisions(scan, catalog).map(decision => ({...decision, target: {existingId: 'known'}}));

  const result = applyImportDecisions(catalog, scan, decisions);

  assert.equal(result.extended, 1);
  assert.equal(result.catalog.isolates[0]?.read_pairs.length, 3);
});
