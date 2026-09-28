import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {
  checkCohortDecision,
  CohortDecisionError,
  cohortDecisionPath,
  listCohortDecisions,
  parseCohortDecision,
  saveCohortDecision,
  validateCohortDecision,
  writeNewFile,
  type CohortDecision,
} from '../../../src/workflows/reference-consensus/cohort-decision.js';
import {validateReferenceConsensusConfiguration} from '../../../src/workflows/reference-consensus/configuration.js';
import {stringifyRunFile} from '../../../src/workflows/run-preparation.js';

const configuration = validateReferenceConsensusConfiguration({
  schema_version: 1,
  workflow_id: 'reference-consensus',
  workflow_version: 1,
  inputs: {
    backbone: {source: 'local', fasta: '/data/backbone.fa'},
    isolates_file: 'isolates.yaml',
    selected_isolates: ['isolate-a', 'isolate-b', 'isolate-c'],
  },
  calling: {ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8},
  consensus: {include_backbone_vote: true, voting_method: 'strict-majority', min_callable_isolates: 0, unresolved_snp: 'n'},
  resources: {cpu_mode: 'automatic', effective_cpus: 2},
  run: {output_root: '/analysis/runs', id: 'run-a', created_at: '2026-01-01T12:00:00.000Z'},
});

const allCompleted = new Set(['isolate-a', 'isolate-b', 'isolate-c']);

function decision(change: Partial<CohortDecision> = {}): CohortDecision {
  return {
    schema_version: 1,
    iteration: 2,
    voting_isolates: ['isolate-a', 'isolate-c'],
    excluded_from_voting: ['isolate-b'],
    consensus: {...configuration.consensus, voting_method: 'plurality'},
    reason: 'Excluded isolate-b after failed coverage review.',
    created_at: '2026-01-01T13:00:00.000Z',
    ...change,
  };
}

function shapeIssues(value: unknown): string[] {
  try {
    validateCohortDecision(value);
  } catch (error) {
    assert.ok(error instanceof CohortDecisionError);
    return error.issues.map(issue => issue.path);
  }
  assert.fail('expected the decision to be refused');
}

function runIssues(value: CohortDecision, completed = allCompleted, saved: CohortDecision[] = []): string[] {
  return checkCohortDecision(value, {configuration, completed, saved}).map(issue => issue.path);
}

async function runDirectory(context: TestContext, completed = [...allCompleted]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'consensus-decision-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(join(directory, 'config.yaml'), stringifyRunFile(configuration));
  for (const id of completed) {
    await mkdir(join(directory, 'results', 'isolates', id), {recursive: true});
    await writeFile(join(directory, 'results', 'isolates', id, 'promotion-candidate.json'), '{}');
  }
  return directory;
}

test('accepts a reasoned decision that splits the selected isolates', () => {
  assert.deepEqual(validateCohortDecision(decision()), decision());
  assert.deepEqual(runIssues(decision()), []);
});

test('refuses a decision without voters, reason, or valid settings', () => {
  assert.deepEqual(shapeIssues(decision({voting_isolates: []})), ['$.voting_isolates']);
  assert.deepEqual(shapeIssues(decision({reason: '  '})), ['$.reason']);
  assert.deepEqual(shapeIssues(decision({iteration: 1})), ['$.iteration']);
  assert.deepEqual(shapeIssues({...decision(), extra: true}), ['$.extra']);
  assert.deepEqual(shapeIssues(decision({created_at: 'today'})), ['$.created_at']);
  assert.deepEqual(
    shapeIssues(decision({consensus: {...configuration.consensus, min_callable_isolates: 3}})),
    ['$.consensus.min_callable_isolates'],
  );
});

test('refuses isolates that do not partition the selected ones', () => {
  assert.deepEqual(runIssues(decision({excluded_from_voting: []})), ['$.excluded_from_voting']);
  assert.deepEqual(
    runIssues(decision({excluded_from_voting: ['isolate-b', 'isolate-a']})),
    ['$.excluded_from_voting[1]'],
  );
  assert.deepEqual(
    runIssues(decision({excluded_from_voting: ['isolate-b', 'isolate-z']})),
    ['$.excluded_from_voting[1]'],
  );
});

test('lets an isolate that did not complete only be excluded', () => {
  const completed = new Set(['isolate-a', 'isolate-c']);
  assert.deepEqual(runIssues(decision(), completed), []);
  assert.deepEqual(
    runIssues(decision({voting_isolates: ['isolate-a', 'isolate-b'], excluded_from_voting: ['isolate-c']}), completed),
    ['$.voting_isolates[1]'],
  );
});

test('refuses a decision that changes nothing or skips an iteration', () => {
  const unchanged = decision({
    voting_isolates: ['isolate-c', 'isolate-b', 'isolate-a'],
    excluded_from_voting: [],
    consensus: configuration.consensus,
  });
  assert.deepEqual(runIssues(unchanged), ['$']);
  assert.deepEqual(runIssues(decision({iteration: 3})), ['$.iteration']);
  const saved = [decision()];
  assert.deepEqual(runIssues(decision({iteration: 3}), allCompleted, saved), ['$']);
  assert.deepEqual(
    runIssues(decision({iteration: 3, consensus: {...decision().consensus, unresolved_snp: 'iupac'}}), allCompleted, saved),
    [],
  );
});

test('saves a decision that round-trips and never replaces a saved one', async context => {
  const directory = await runDirectory(context);
  const path = await saveCohortDecision(directory, decision());
  assert.equal(path, cohortDecisionPath(directory, 2));
  assert.deepEqual(parseCohortDecision(await readFile(path, 'utf8')), decision());
  assert.deepEqual(await listCohortDecisions(directory), [decision()]);

  const original = await readFile(path, 'utf8');
  await assert.rejects(
    saveCohortDecision(directory, decision({consensus: {...decision().consensus, unresolved_snp: 'iupac'}})),
    CohortDecisionError,
  );
  assert.equal(await readFile(path, 'utf8'), original);

  await saveCohortDecision(directory, decision({iteration: 3, consensus: {...decision().consensus, unresolved_snp: 'iupac'}}));
  assert.deepEqual((await listCohortDecisions(directory)).map(saved => saved.iteration), [2, 3]);
});

test('excludes a failed isolate in the first saved decision', async context => {
  const directory = await runDirectory(context, ['isolate-a', 'isolate-c']);
  await saveCohortDecision(directory, decision({consensus: configuration.consensus}));
  await assert.rejects(
    saveCohortDecision(directory, decision({
      iteration: 3,
      voting_isolates: ['isolate-a', 'isolate-b'],
      excluded_from_voting: ['isolate-c'],
    })),
    (error: unknown) => error instanceof CohortDecisionError &&
      error.issues.some(issue => issue.path === '$.voting_isolates[1]'),
  );
});

test('refuses a saved decision file whose name and iteration disagree', async context => {
  const directory = await runDirectory(context);
  await mkdir(join(directory, 'decisions'));
  await writeFile(cohortDecisionPath(directory, 4), stringifyRunFile(decision()));
  await assert.rejects(listCohortDecisions(directory), CohortDecisionError);
});

test('never replaces a decision file that appeared after the run was checked', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'consensus-decision-race-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const path = join(directory, 'iteration-2.yaml');
  await writeFile(path, 'saved by another window\n');

  await assert.rejects(writeNewFile(path, 'a second decision\n'), {code: 'EEXIST'});
  assert.equal(await readFile(path, 'utf8'), 'saved by another window\n');
  assert.deepEqual(await readdir(directory), ['iteration-2.yaml']);

  const fresh = join(directory, 'iteration-3.yaml');
  await writeNewFile(fresh, 'new\n');
  assert.equal(await readFile(fresh, 'utf8'), 'new\n');
  assert.deepEqual((await readdir(directory)).sort(), ['iteration-2.yaml', 'iteration-3.yaml']);
});
