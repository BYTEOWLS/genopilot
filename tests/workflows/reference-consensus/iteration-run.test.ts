import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {resolveToolingPaths} from '../../../src/tooling/paths.js';
import {
  checkIterationDryRun,
  iterationRules,
  iterationTarget,
  prepareIterationRun,
} from '../../../src/workflows/reference-consensus/iteration-run.js';
import {stringifyRunFile} from '../../../src/workflows/run-preparation.js';

const configuration = {
  schema_version: 1,
  workflow_id: 'reference-consensus',
  workflow_version: 1,
  inputs: {
    backbone: {source: 'ncbi', accession: 'GCF_000000001.1'},
    isolates_file: 'isolates.yaml',
    selected_isolates: ['isolate-a', 'isolate-b'],
  },
  calling: {ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8},
  consensus: {include_backbone_vote: true, voting_method: 'strict-majority', min_callable_isolates: 0, unresolved_snp: 'n'},
  resources: {cpu_mode: 'automatic', effective_cpus: 5},
  run: {output_root: '/analysis/runs', id: 'run-a', created_at: '2026-01-01T12:00:00.000Z'},
};

async function runDirectory(context: TestContext): Promise<{tempDir: string; directory: string}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'iteration-run-'));
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const directory = join(tempDir, 'run');
  await mkdir(directory);
  await writeFile(join(directory, 'config.yaml'), stringifyRunFile(configuration));
  return {tempDir, directory};
}

function event(type: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({schema_version: 1, timestamp: '2026-01-01T13:00:00.000Z', type, ...fields});
}

async function dryRunEvents(directory: string, lines: string[]): Promise<string> {
  const path = join(directory, 'logs/cohort/iteration-2/dry-run.events.jsonl');
  await mkdir(join(directory, 'logs/cohort/iteration-2'), {recursive: true});
  await writeFile(path, `${lines.join('\n')}\n`);
  return path;
}

test('runs only the iteration target, with its logs beside the iteration\'s', async context => {
  const {tempDir, directory} = await runDirectory(context);
  const paths = resolveToolingPaths({platform: 'linux', architecture: 'x64', homeDirectory: tempDir});
  const startedAt = new Date('2026-09-06T08:50:14.123Z');
  const options = {runDirectory: directory, iteration: 2, snakefilePath: join(tempDir, 'Snakefile'), cores: 5, paths, startedAt};
  const dryRun = prepareIterationRun({...options, mode: 'dry-run'});
  const execution = prepareIterationRun({...options, mode: 'execute'});

  assert.equal(dryRun.arguments.at(-1), 'provenance/cohort/iteration-2.json');
  assert.equal(execution.arguments.at(-1), iterationTarget(2));
  assert.equal(dryRun.arguments[dryRun.arguments.indexOf('--cores') + 1], '5');
  assert.equal(dryRun.arguments[dryRun.arguments.indexOf('--configfile') + 1], join(directory, 'config.yaml'));
  assert.ok(dryRun.arguments.includes('--dry-run'));
  // An interrupted iteration is continued with the same target; both modes show the same plan.
  assert.ok(dryRun.arguments.includes('--rerun-incomplete'));
  assert.ok(execution.arguments.includes('--rerun-incomplete'));
  assert.ok(!execution.arguments.includes('--dry-run'));

  // The dry run records what it would schedule in a file of its own, never in events.jsonl.
  assert.equal(dryRun.eventsPath, undefined);
  assert.equal(dryRun.dryRunEventsPath, join(directory, 'logs/cohort/iteration-2/snakemake-dry-run.2026-09-06_085014123.events.jsonl'));
  assert.equal(dryRun.arguments[dryRun.arguments.indexOf('--logger-genopilot-run-events-path') + 1], dryRun.dryRunEventsPath);
  // The execution appends to the run's events, from which the iteration's provenance reads its commands.
  assert.equal(execution.eventsPath, join(directory, 'events.jsonl'));
  assert.equal(execution.dryRunEventsPath, undefined);
  assert.equal(execution.stdoutLogPath, join(directory, 'logs/cohort/iteration-2/snakemake-execute.2026-09-06_085014123.stdout.log'));
  assert.equal(execution.stderrLogPath, join(directory, 'logs/cohort/iteration-2/snakemake-execute.2026-09-06_085014123.stderr.log'));
});

test('allows an execution only when the dry run schedules nothing but the cohort rules', async context => {
  const {directory} = await runDirectory(context);
  const allowed = await dryRunEvents(directory, [
    event('workflow-started'),
    event('run-info', {jobs: {aggregate_support: 1, generate_consensus: 1, record_iteration_provenance: 1}, total: 3}),
    event('run-info', {jobs: {generate_consensus: 1, record_iteration_provenance: 1}, total: 2}),
  ]);
  assert.deepEqual(await checkIterationDryRun({runDirectory: directory, dryRunEventsPath: allowed}, 2), {allowed: true});
  assert.equal(iterationRules.length, 3);

  const refused = await dryRunEvents(directory, [
    event('run-info', {
      jobs: {call_all_sites: 1, classify_callability: 1, aggregate_support: 1, generate_consensus: 1, record_iteration_provenance: 1},
      total: 5,
    }),
  ]);
  const check = await checkIterationDryRun({runDirectory: directory, dryRunEventsPath: refused}, 2);
  assert.equal(check.allowed, false);
  assert.ok(!check.allowed);
  assert.deepEqual(check.otherRules, {call_all_sites: 1, classify_callability: 1});
  assert.match(check.reason, /call_all_sites \(1\)/);
});

test('refuses when the dry run did not say what it would schedule', async context => {
  const {directory} = await runDirectory(context);

  const missing = await checkIterationDryRun({runDirectory: directory, dryRunEventsPath: join(directory, 'absent.jsonl')}, 2);
  assert.equal(missing.allowed, false);

  // A different schema version is not interpreted, so it cannot allow an execution.
  const foreign = await dryRunEvents(directory, [
    JSON.stringify({schema_version: 2, type: 'run-info', jobs: {generate_consensus: 1}, total: 1}),
    'not json',
  ]);
  const unknown = await checkIterationDryRun({runDirectory: directory, dryRunEventsPath: foreign}, 2);
  assert.ok(!unknown.allowed);
  assert.match(unknown.reason, /no provenance yet/);

  // Nothing scheduled with the provenance in place: the iteration is already complete.
  await mkdir(join(directory, 'provenance/cohort'), {recursive: true});
  await writeFile(join(directory, 'provenance/cohort/iteration-2.json'), '{}');
  const nothing = await dryRunEvents(directory, [event('workflow-started')]);
  const complete = await checkIterationDryRun({runDirectory: directory, dryRunEventsPath: nothing}, 2);
  assert.ok(!complete.allowed);
  assert.match(complete.reason, /already complete/);
});
