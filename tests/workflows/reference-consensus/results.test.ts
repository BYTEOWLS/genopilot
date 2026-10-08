import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test, {type TestContext} from 'node:test';
import type {CohortDecision} from '../../../src/workflows/reference-consensus/cohort-decision.js';
import {validateReferenceConsensusConfiguration} from '../../../src/workflows/reference-consensus/configuration.js';
import {cohortPathKeys, isolatePathKeys} from '../../../src/workflows/reference-consensus/results.js';
import type {WorkflowManifest} from '../../../src/workflows/manifest.js';
import {
  isReferenceConsensusResult,
  loadWorkflowResult,
  type CompatibleReferenceConsensusResult,
  type LoadedWorkflowResult,
} from '../../../src/workflows/results.js';
import {discoverWorkflowRuns} from '../../../src/workflows/run-discovery.js';
import {stringifyRunFile} from '../../../src/workflows/run-preparation.js';

const isolateIds = ['isolate-a', 'isolate-b', 'isolate-c'];

const manifest: WorkflowManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'reference-consensus',
  label: 'Label may change',
  description: 'Description.',
  entry_snakefile: 'Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [],
  artifacts: [],
};

const configuration = validateReferenceConsensusConfiguration({
  schema_version: 1,
  workflow_id: 'reference-consensus',
  workflow_version: 1,
  genopilot: {version: '1.2.3', igv: '3.8.9'},
  inputs: {
    backbone: {source: 'ncbi', accession: 'GCF_000000001.1'},
    isolates_file: 'isolates.yaml',
    selected_isolates: isolateIds,
  },
  calling: {ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8},
  consensus: {include_backbone_vote: true, voting_method: 'strict-majority', min_callable_isolates: 0, unresolved_snp: 'n'},
  resources: {cpu_mode: 'automatic', effective_cpus: 3},
  run: {output_root: '/analysis/runs', id: 'run-a', created_at: '2026-01-01T12:00:00.000Z'},
});

const snapshot = {
  schema_version: 1,
  captured_at: '2026-01-01T12:00:00.000Z',
  isolates: isolateIds.map((id, index) => ({
    id,
    name: `Isolate ${id.at(-1)!.toUpperCase()}`,
    wildtype: index === 0 ? true : index === 1 ? false : null,
    derived_from: index === 1 ? 'isolate-a' : null,
    read_pairs: [{r1: `/reads/${id}_R1.fastq.gz`, r2: `/reads/${id}_R2.fastq.gz`, trimmed: false}],
  })),
};

function reasons(tie: number, noMajority = 0, noVotes = 0, fewCallable = 0) {
  return {tie, no_majority: noMajority, no_votes: noVotes, few_callable: fewCallable};
}

function consensusSummary(tie: number) {
  return {
    schema_version: 1,
    loci: {selected: 40, changed: 12, unresolved: reasons(tie, 1)},
    loci_by_flag: {
      multiallelic: {selected: 2, unresolved: reasons(1)},
      competing_indel: {selected: 0, unresolved: reasons(0, 1)},
    },
    bases: {backbone_only: 7, iupac: 0, n: {...reasons(tie, 1, 5), backbone_not_acgt: 3}},
  };
}

async function writeJson(directory: string, path: string, value: unknown): Promise<void> {
  await mkdir(dirname(join(directory, path)), {recursive: true});
  await writeFile(join(directory, path), JSON.stringify(value));
}

async function touch(directory: string, path: string): Promise<void> {
  await mkdir(dirname(join(directory, path)), {recursive: true});
  await writeFile(join(directory, path), '');
}

async function writeIsolate(directory: string, id: string): Promise<void> {
  const base = `results/isolates/${id}`;
  for (const name of ['alignment.bam', 'alignment.bam.bai', 'variants.vcf.gz', 'variants.vcf.gz.csi', 'callable-mask.bed',
    'consensus-mask.bed', 'consensus.fasta', 'consensus.fasta.fai', 'consensus.chain', 'provenance.json']) {
    await touch(directory, `${base}/${name}`);
  }
  await mkdir(join(directory, 'logs/isolates', id), {recursive: true});
  await writeJson(directory, `${base}/metrics.json`, {
    schema_version: 1,
    trimmed: 'untrimmed',
    coverage: {mean_depth: 41.26, covered_fraction: 0.99},
    callability: {callable_fraction: 0.953},
    variants: {snps: 1200, indels: 85},
  });
  await writeJson(directory, `${base}/promotion-candidate.json`, {
    schema_version: 1,
    isolate_id: id,
    fasta: {path: `${base}/consensus.fasta`, sha256: 'a'.repeat(64)},
    fasta_index: {path: `${base}/consensus.fasta.fai`, sha256: 'b'.repeat(64)},
  });
}

async function writeCohort(directory: string, cohort: string, tie: number): Promise<void> {
  const base = `results/cohort/${cohort}`;
  for (const name of ['support-sites.tsv.gz', 'support-intervals.tsv.gz', 'consensus.fasta', 'consensus-sites.tsv.gz']) {
    await touch(directory, `${base}/${name}`);
  }
  await writeJson(directory, `${base}/support-summary.json`, {schema_version: 1});
  await writeJson(directory, `${base}/consensus-summary.json`, consensusSummary(tie));
  await mkdir(join(directory, 'logs/cohort', cohort), {recursive: true});
}

function decision(iteration: number, change: Partial<CohortDecision> = {}): CohortDecision {
  return {
    schema_version: 1,
    iteration,
    voting_isolates: ['isolate-a', 'isolate-c'],
    excluded_from_voting: ['isolate-b'],
    consensus: {...configuration.consensus, voting_method: 'plurality'},
    reason: 'isolate-b reads are unusable.',
    created_at: `2026-01-0${String(iteration)}T09:00:00.000Z`,
    ...change,
  };
}

/** Saves a decision and, unless `run` is false, the provenance of its completed iteration. */
async function writeIteration(
  directory: string,
  value: CohortDecision,
  {run = true, tie = 0, initialAggregated = true}: {run?: boolean; tie?: number; initialAggregated?: boolean} = {},
): Promise<void> {
  const id = `iteration-${String(value.iteration)}`;
  const decisionPath = join(directory, 'decisions', `${id}.yaml`);
  await mkdir(dirname(decisionPath), {recursive: true});
  await writeFile(decisionPath, stringifyRunFile(value));
  if (!run) {
    return;
  }
  await writeCohort(directory, id, tie);
  await writeJson(directory, `provenance/cohort/${id}.json`, {
    schema_version: 1,
    generated_at: `2026-01-0${String(value.iteration)}T10:00:00.000Z`,
    run: {id: 'run-a'},
    cohort: id,
    decision: {
      path: `decisions/${id}.yaml`,
      checksum: {algorithm: 'sha256', value: createHash('sha256').update(await readFile(decisionPath)).digest('hex')},
    },
    excluded_isolates: Object.fromEntries(value.excluded_from_voting.map(isolate => [isolate, {processing: 'incomplete'}])),
    initial_cohort: {aggregated: initialAggregated},
  });
}

/** A run directory under `<tempDir>/reference-consensus/run-a`, with the given isolates processed. */
async function runDirectory(
  context: TestContext,
  {completed = isolateIds, initial = true}: {completed?: readonly string[]; initial?: boolean} = {},
): Promise<{tempDir: string; directory: string}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'consensus-results-'));
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const directory = join(tempDir, 'reference-consensus', 'run-a');
  await mkdir(join(directory, 'logs'), {recursive: true});
  await writeFile(join(directory, 'config.yaml'), stringifyRunFile(configuration));
  await writeFile(join(directory, 'isolates.yaml'), stringifyRunFile(snapshot));
  await touch(directory, 'artifacts.yaml');
  await touch(directory, 'results/input-validation.json');
  await touch(directory, 'resolved/backbone.fasta');
  await writeJson(directory, 'provenance/backbone.fasta.json', {
    schema_version: 1,
    source: 'ncbi',
    accession: 'GCF_000000001.1',
    downloaded: false,
    checksum: {algorithm: 'sha256', value: 'c'.repeat(64)},
    origin: 'imported',
  });
  for (const id of completed) {
    await writeIsolate(directory, id);
  }
  if (initial) {
    await writeCohort(directory, 'initial', 3);
    await writeJson(directory, 'provenance/run.json', {schema_version: 1, generated_at: '2026-01-01T15:00:00.000Z'});
  }
  return {tempDir, directory};
}

function consensusResult(loaded: LoadedWorkflowResult): CompatibleReferenceConsensusResult {
  assert.ok(isReferenceConsensusResult(loaded), JSON.stringify(loaded.kind === 'incompatible' ? loaded.error : loaded.kind));
  return loaded;
}

function missing(loaded: CompatibleReferenceConsensusResult): string[] {
  return loaded.shell.linkedPaths.filter(path => !path.available).map(path => path.path);
}

test('reads a completed run: backbone, isolates, and the initial cohort', async context => {
  const {directory} = await runDirectory(context);
  const loaded = consensusResult(await loadWorkflowResult(directory, manifest));
  const {result} = loaded;

  assert.deepEqual(
    {source: result.backbone.source, accession: result.backbone.accession, downloaded: result.backbone.downloaded, issues: result.backbone.issues},
    {source: 'ncbi', accession: 'GCF_000000001.1', downloaded: false, issues: []},
  );
  assert.deepEqual(result.isolates.map(isolate => [isolate.id, isolate.state, isolate.promotionCandidate]), [
    ['isolate-a', 'completed', true],
    ['isolate-b', 'completed', true],
    ['isolate-c', 'completed', true],
  ]);
  assert.deepEqual(result.isolates[1]!.metrics, {
    meanDepth: 41.26, coveredFraction: 0.99, callableFraction: 0.953, snps: 1200, indels: 85, trimmed: 'untrimmed',
  });
  assert.deepEqual([result.isolates[1]!.wildtype, result.isolates[1]!.derivedFrom], [false, 'isolate-a']);
  assert.equal(result.activeCohortId, 'initial');
  assert.equal(result.baselineCohortId, 'initial');
  const initial = result.cohorts[0]!;
  assert.equal(initial.state, 'completed');
  assert.deepEqual(initial.voters, isolateIds);
  assert.deepEqual(initial.counts?.lociUnresolved, reasons(3, 1));
  assert.equal(initial.counts?.multiallelicLoci, 3);
  assert.equal(initial.counts?.competingIndelLoci, 1);
  assert.deepEqual(loaded.shell.runStatus, 'completed');
  assert.equal(loaded.shell.status.variant, 'success');
  assert.equal(loaded.shell.generatedAt, '2026-01-01T15:00:00.000Z');
  assert.equal(loaded.shell.effectiveCpus, 3);
  assert.deepEqual(missing(loaded), []);
});

test('reports a missing artifact and an unsupported record without hiding the rest', async context => {
  const {directory} = await runDirectory(context);
  await rm(join(directory, 'results/isolates/isolate-a/alignment.bam'));
  await rm(join(directory, 'results/cohort/initial/consensus-summary.json'));
  await writeJson(directory, 'results/isolates/isolate-c/metrics.json', {schema_version: 2});

  const {result, shell} = consensusResult(await loadWorkflowResult(directory, manifest));

  assert.deepEqual(missing({shell} as CompatibleReferenceConsensusResult).sort(), [
    'results/cohort/initial/consensus-summary.json',
    'results/isolates/isolate-a/alignment.bam',
  ]);
  const initial = result.cohorts[0]!;
  assert.equal(initial.state, 'completed');
  assert.equal(initial.counts, undefined);
  assert.deepEqual(initial.issues.map(issue => issue.path), ['results/cohort/initial/consensus-summary.json']);
  const isolateC = result.isolates[2]!;
  assert.equal(isolateC.metrics, undefined);
  assert.deepEqual(isolateC.issues.map(issue => issue.path), ['results/isolates/isolate-c/metrics.json']);
  assert.match(isolateC.issues[0]!.message, /schema version 2/);
  assert.ok(result.isolates[0]!.metrics, 'the other isolates keep their metrics');
});

test('reads an excluded failed isolate whose initial cohort never ran', async context => {
  const {directory} = await runDirectory(context, {completed: ['isolate-a', 'isolate-c'], initial: false});
  await touch(directory, 'logs/isolates/isolate-b/mark-duplicates.log');
  await writeIteration(directory, decision(2), {initialAggregated: false});

  const loaded = consensusResult(await loadWorkflowResult(directory, manifest));
  const {result} = loaded;

  assert.equal(result.isolates[1]!.state, 'incomplete');
  assert.equal(result.isolates[1]!.promotionCandidate, false);
  assert.equal(result.isolates[1]!.paths.logs.available, true);
  assert.deepEqual(result.cohorts.map(cohort => [cohort.id, cohort.state]), [
    ['initial', 'not-aggregated'],
    ['iteration-2', 'completed'],
  ]);
  assert.equal(result.activeCohortId, 'iteration-2');
  assert.equal(result.baselineCohortId, 'iteration-2');
  assert.equal(result.initialNotAggregatedReason, 'isolate-b reads are unusable.');
  const iteration = result.cohorts[1]!;
  assert.deepEqual(iteration.excluded, [{id: 'isolate-b', processing: 'incomplete'}]);
  assert.equal(iteration.initialAggregated, false);
  assert.equal(iteration.settings?.voting_method, 'plurality');
  assert.equal(loaded.shell.runStatus, 'completed');
  // The incomplete isolate's and the never-aggregated cohort's files are not expected to exist.
  assert.deepEqual(missing(loaded), []);
});

test('distinguishes pending and invalid iterations and keeps the latest completed one active', async context => {
  const {directory} = await runDirectory(context);
  await writeIteration(directory, decision(2), {tie: 1});
  await writeIteration(directory, decision(3, {voting_isolates: isolateIds, excluded_from_voting: []}), {run: false});
  // Provenance of iteration 4 without its decision.
  await writeJson(directory, 'provenance/cohort/iteration-4.json', {schema_version: 1, cohort: 'iteration-4', run: {id: 'run-a'}});

  const {result} = consensusResult(await loadWorkflowResult(directory, manifest));

  assert.deepEqual(result.cohorts.map(cohort => [cohort.id, cohort.state]), [
    ['initial', 'completed'],
    ['iteration-2', 'completed'],
    ['iteration-3', 'pending'],
    ['iteration-4', 'invalid'],
  ]);
  assert.equal(result.activeCohortId, 'iteration-2');
  assert.equal(result.baselineCohortId, 'initial');
  assert.equal(result.cohorts[2]!.decidedAt, '2026-01-03T09:00:00.000Z');
  assert.deepEqual(result.cohorts[3]!.issues.map(issue => issue.path), ['decisions/iteration-4.yaml']);
});

test('refuses an iteration whose decision changed after it ran', async context => {
  const {directory} = await runDirectory(context);
  await writeIteration(directory, decision(2));
  await writeFile(join(directory, 'decisions/iteration-2.yaml'), stringifyRunFile(decision(2, {reason: 'Edited later.'})));

  const {result} = consensusResult(await loadWorkflowResult(directory, manifest));

  const iteration = result.cohorts[1]!;
  assert.equal(iteration.state, 'invalid');
  assert.match(iteration.issues[0]!.message, /checksum/);
  assert.equal(result.activeCohortId, 'initial');
});

test('reports a run without any cohort as incomplete and names the unfinished isolates', async context => {
  const {tempDir, directory} = await runDirectory(context, {completed: ['isolate-a'], initial: false});

  const loaded = consensusResult(await loadWorkflowResult(directory, manifest));

  assert.equal(loaded.result.activeCohortId, undefined);
  assert.equal(loaded.shell.runStatus, 'incomplete');
  assert.equal(loaded.shell.status.variant, 'warning');
  assert.match(loaded.shell.status.explanation, /isolate-b, isolate-c/);
  const [discovered] = await discoverWorkflowRuns(tempDir, manifest);
  assert.equal(discovered?.status, 'incomplete');
  assert.equal(discovered?.missingLinkedPaths, 0);
});

test('counts the missing linked paths of a discovered run', async context => {
  const {tempDir, directory} = await runDirectory(context);
  await rm(join(directory, 'results/cohort/initial/consensus.fasta'));

  const [discovered] = await discoverWorkflowRuns(tempDir, manifest);

  assert.equal(discovered?.status, 'completed');
  assert.equal(discovered?.missingLinkedPaths, 1);
});

test('refuses a run whose isolate snapshot is missing or names an unsafe isolate ID', async context => {
  const {directory} = await runDirectory(context);
  await rm(join(directory, 'isolates.yaml'));
  const missingSnapshot = await loadWorkflowResult(directory, manifest);
  assert.equal(missingSnapshot.kind === 'incompatible' && missingSnapshot.error.kind, 'missing-configuration');

  const unsafe = {...snapshot, isolates: snapshot.isolates.map((isolate, index) => index === 0 ? {...isolate, id: '../escape'} : isolate)};
  await writeFile(join(directory, 'isolates.yaml'), stringifyRunFile(unsafe));
  const refused = await loadWorkflowResult(directory, manifest);
  assert.equal(refused.kind === 'incompatible' && refused.error.kind, 'invalid-configuration');
});

test('exposes every isolate and cohort path key', async context => {
  const {directory} = await runDirectory(context);
  await writeIteration(directory, decision(2));
  const {result} = consensusResult(await loadWorkflowResult(directory, manifest));
  assert.deepEqual(Object.keys(result.isolates[0]!.paths).sort(), [...isolatePathKeys].sort());
  assert.deepEqual(Object.keys(result.cohorts[1]!.paths).sort(), [...cohortPathKeys].sort());
  assert.deepEqual(Object.keys(result.cohorts[0]!.paths).sort(), cohortPathKeys.filter(key => key !== 'decision').sort());
});
