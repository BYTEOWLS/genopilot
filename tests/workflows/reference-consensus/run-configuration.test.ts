import assert from 'node:assert/strict';
import {link, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import type {AccessionEntry} from '../../../src/accessions/catalog.js';
import type {Isolate, IsolateCatalog} from '../../../src/isolates/catalog.js';
import {
  parseReferenceConsensusConfiguration,
  ReferenceConsensusConfigurationError,
} from '../../../src/workflows/reference-consensus/configuration.js';
import {
  applyBackboneCacheMode,
  buildReferenceConsensusRun,
  discoverReferenceConsensusRuns,
  hasBackboneCacheEntry,
  inspectPreparedRun,
  reviewWarnings,
  savePreparedRun,
  type ReferenceConsensusDraft,
} from '../../../src/workflows/reference-consensus/run-configuration.js';
import {parseIsolateSnapshot} from '../../../src/workflows/reference-consensus/snapshot.js';
import {createRunWorkspace} from '../../../src/workflows/run-preparation.js';

const now = new Date('2026-09-25T10:00:00.000Z');
const fastq = '@read1\nACGT\n+\nIIII\n';

async function temporaryRoot(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-consensus-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

async function readPair(root: string, name: string, trimmed = false): Promise<Isolate['read_pairs'][number]> {
  await mkdir(join(root, 'reads'), {recursive: true});
  const pair = {r1: join(root, 'reads', `${name}_R1.fastq`), r2: join(root, 'reads', `${name}_R2.fastq`), trimmed};
  await writeFile(pair.r1, fastq);
  await writeFile(pair.r2, fastq);
  return pair;
}

async function fixture(context: TestContext): Promise<{root: string; catalog: IsolateCatalog; draft: ReferenceConsensusDraft}> {
  const root = await temporaryRoot(context);
  await writeFile(join(root, 'backbone.fa'), '>chr1\nACGT\n');
  const catalog: IsolateCatalog = {
    schema_version: 1,
    isolates: [
      {
        id: 'isolate-a',
        name: 'Isolate A',
        wildtype: true,
        derived_from: null,
        read_pairs: [await readPair(root, 'a-lane1'), await readPair(root, 'a-lane2')],
      },
      {
        id: 'isolate-b',
        name: 'Isolate B',
        description: 'Derived line',
        wildtype: false,
        derived_from: 'isolate-a',
        read_pairs: [await readPair(root, 'b')],
      },
    ],
  };
  const draft: ReferenceConsensusDraft = {
    backboneSource: 'local',
    backboneFasta: 'backbone.fa',
    backboneAccession: '',
    isolateIds: ['isolate-b', 'isolate-a'],
    votingMethod: 'strict-majority',
    includeBackboneVote: true,
    minCallableIsolates: '1',
    unresolvedSnp: 'iupac',
    minDepth: '10',
    minMappingQuality: '20',
    minBaseQuality: '20',
    minAlleleFraction: '0.8',
    cpuMode: 'manual',
    manualCpuLimit: '2',
    outputRoot: 'runs',
    runName: 'Cohort one',
    runDescription: '',
  };
  return {root, catalog, draft};
}

function issuesOf(error: unknown): {path: string; message: string}[] {
  assert.ok(error instanceof ReferenceConsensusConfigurationError);
  return [...error.issues];
}

const noAccessions = async (): Promise<readonly AccessionEntry[]> => [];

test('snapshots every selected isolate with all read pairs in selection order', async context => {
  const {root, catalog, draft} = await fixture(context);
  const prepared = buildReferenceConsensusRun(draft, catalog, root, 8, now);

  const {configuration, snapshot} = prepared;
  assert.deepEqual(configuration.inputs.selected_isolates, ['isolate-b', 'isolate-a']);
  assert.deepEqual(configuration.inputs.backbone, {source: 'local', fasta: join(root, 'backbone.fa')});
  assert.deepEqual(configuration.calling, {
    ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8,
  });
  assert.deepEqual(configuration.consensus, {
    include_backbone_vote: true, voting_method: 'strict-majority', min_callable_isolates: 1, unresolved_snp: 'iupac',
  });
  assert.deepEqual(configuration.resources, {cpu_mode: 'manual', manual_limit: 2, effective_cpus: 2});
  assert.equal(configuration.run.id, '2026-09-25_100000000_Cohort-one');
  assert.equal(prepared.outputDirectory, join(root, 'runs', 'reference-consensus', configuration.run.id));
  assert.deepEqual(snapshot.isolates.map(isolate => isolate.id), ['isolate-b', 'isolate-a']);
  assert.deepEqual(snapshot.isolates[1], catalog.isolates[0]);
  assert.equal(snapshot.captured_at, now.toISOString());
  // The snapshot is a copy: changing the catalog afterwards leaves the run's record alone.
  catalog.isolates[0]!.read_pairs[0]!.trimmed = true;
  assert.equal(snapshot.isolates[1]?.read_pairs[0]?.trimmed, false);
});

test('refuses a selected isolate that is no longer cataloged and an empty or invalid threshold', async context => {
  const {root, catalog, draft} = await fixture(context);
  assert.throws(
    () => buildReferenceConsensusRun({...draft, isolateIds: ['isolate-a', 'gone']}, catalog, root, 8, now),
    error => issuesOf(error).some(issue => issue.path === '$.inputs.selected_isolates[1]'),
  );
  assert.throws(
    () => buildReferenceConsensusRun({...draft, isolateIds: []}, catalog, root, 8, now),
    error => issuesOf(error).some(issue => issue.path === '$.inputs.selected_isolates'),
  );
  assert.throws(
    () => buildReferenceConsensusRun({...draft, minMappingQuality: ''}, catalog, root, 8, now),
    error => issuesOf(error).some(issue => issue.path === '$.calling.min_mapping_quality'),
  );
  assert.throws(
    () => buildReferenceConsensusRun({...draft, minAlleleFraction: '0.4'}, catalog, root, 8, now),
    error => issuesOf(error).some(issue => issue.path === '$.calling.min_allele_fraction'),
  );
  // An empty minimum is not silently read as zero, and it cannot exceed the two selected isolates.
  for (const minCallableIsolates of ['', '3']) {
    assert.throws(
      () => buildReferenceConsensusRun({...draft, minCallableIsolates}, catalog, root, 8, now),
      error => issuesOf(error).some(issue => issue.path === '$.consensus.min_callable_isolates'),
    );
  }
});

test('blocks a missing read file and an unreadable backbone before review', async context => {
  const {root, catalog, draft} = await fixture(context);
  const prepared = buildReferenceConsensusRun(draft, catalog, root, 8, now);
  await rm(catalog.isolates[0]!.read_pairs[1]!.r2);
  await rm(join(root, 'backbone.fa'));
  await assert.rejects(inspectPreparedRun(prepared, {readAccessions: noAccessions}), error => {
    const issues = issuesOf(error);
    assert.ok(issues.some(issue => issue.path === '$.inputs.backbone.fasta'));
    assert.ok(issues.some(issue => issue.path.includes("'isolate-a' pair 2 R2") && issue.message.includes('file not found')));
    return true;
  });
});

test('refuses a backbone accession whose cataloged copies conflict', async context => {
  const {root, catalog, draft} = await fixture(context);
  const prepared = buildReferenceConsensusRun(
    {...draft, backboneSource: 'ncbi', backboneAccession: 'gcf_000149205.2'},
    catalog,
    root,
    8,
    now,
  );
  assert.deepEqual(prepared.configuration.inputs.backbone, {
    source: 'ncbi', accession: 'GCF_000149205.2', ncbi_cache_mode: 'reuse',
  });
  const copy = (path: string, sha: string) => ({path, verified_at: now.toISOString(), fasta_sha256: sha});
  const conflicting: AccessionEntry = {
    accession: 'GCF_000149205.2',
    ncbi: null,
    cached_copies: [copy('/one', 'a'.repeat(64)), copy('/two', 'b'.repeat(64))],
  };
  await assert.rejects(
    inspectPreparedRun(prepared, {readAccessions: async () => [conflicting]}),
    error => issuesOf(error).some(issue => issue.path === '$.inputs.backbone.accession'),
  );
  const inspection = await inspectPreparedRun(prepared, {
    readAccessions: async () => [{...conflicting, cached_copies: [copy('/one', 'a'.repeat(64))]}],
  });
  assert.equal(inspection.backboneEntry?.accession, 'GCF_000149205.2');
});

test('warns about linked read files, a possible backbone sample, and mixed trimming', async context => {
  const {root, catalog, draft} = await fixture(context);
  const clean = buildReferenceConsensusRun(draft, catalog, root, 8, now);
  assert.deepEqual(reviewWarnings(clean, await inspectPreparedRun(clean, {readAccessions: noAccessions})), []);

  // Isolate B's R2 becomes a hard link to isolate A's first R1, and one of A's pairs is trimmed.
  const b = catalog.isolates[1]!.read_pairs[0]!;
  await rm(b.r2);
  await link(catalog.isolates[0]!.read_pairs[0]!.r1, b.r2);
  catalog.isolates[0]!.read_pairs[1]!.trimmed = true;
  const strain: AccessionEntry = {
    accession: 'GCF_000149205.2',
    ncbi: {organism: 'Example organism', strain: 'ISOLATE-B', retrieved_at: now.toISOString(), source: 'datasets-v2-rest'},
    cached_copies: [],
  };
  const prepared = buildReferenceConsensusRun(
    {...draft, backboneSource: 'ncbi', backboneAccession: 'GCF_000149205.2'},
    catalog,
    root,
    8,
    now,
  );
  const warnings = reviewWarnings(prepared, await inspectPreparedRun(prepared, {readAccessions: async () => [strain]}));
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some(warning => warning.includes(b.r2)));
  assert.ok(warnings.some(warning => warning.includes('(isolate-b)')));
  assert.ok(warnings.some(warning => warning.includes('Isolate A') && !warning.includes('(isolate-b)')));
});

test('saves the snapshot and configuration together and never overwrites a run', async context => {
  const {root, catalog, draft} = await fixture(context);
  const prepared = buildReferenceConsensusRun(draft, catalog, root, 8, now);
  const configurationPath = await savePreparedRun(prepared, {readAccessions: noAccessions});

  assert.equal(configurationPath, join(prepared.outputDirectory, 'config.yaml'));
  const configuration = parseReferenceConsensusConfiguration(await readFile(configurationPath, 'utf8'));
  assert.deepEqual(configuration, prepared.configuration);
  const snapshot = parseIsolateSnapshot(
    await readFile(join(prepared.outputDirectory, 'isolates.yaml'), 'utf8'),
    configuration.inputs.selected_isolates,
  );
  assert.deepEqual(snapshot, prepared.snapshot);

  await assert.rejects(
    savePreparedRun(prepared, {readAccessions: noAccessions}),
    error => issuesOf(error).some(issue => issue.path === '$.run.id'),
  );
  const saved = await discoverReferenceConsensusRuns(join(root, 'runs'));
  assert.deepEqual(saved.map(record => record.configuration.run.id), [configuration.run.id]);
});

test('removes a partly written run workspace when a later file fails', async context => {
  const root = await temporaryRoot(context);
  const directory = join(root, 'runs', 'reference-consensus', 'broken');
  await assert.rejects(createRunWorkspace(
    directory,
    [{name: 'isolates.yaml', content: 'a'}, {name: 'missing/config.yaml', content: 'b'}],
    () => new Error('exists'),
  ));
  assert.deepEqual(await readdir(join(root, 'runs', 'reference-consensus')), []);
});

test('asks about an existing backbone cache entry and saves the decision', async context => {
  const {root, catalog, draft} = await fixture(context);
  const prepared = buildReferenceConsensusRun(
    {...draft, backboneSource: 'ncbi', backboneAccession: 'GCF_000149205.2'},
    catalog,
    root,
    8,
    now,
  );
  assert.equal(await hasBackboneCacheEntry(prepared), false);
  await mkdir(join(root, 'runs', 'ncbi-accessions-cache', 'GCF_000149205.2'), {recursive: true});
  assert.equal(await hasBackboneCacheEntry(prepared), true);
  const refreshed = applyBackboneCacheMode(prepared, 'refresh');
  assert.deepEqual(refreshed.configuration.inputs.backbone, {
    source: 'ncbi', accession: 'GCF_000149205.2', ncbi_cache_mode: 'refresh',
  });
});

test('does not take an isolate named after the backbone strain for the backbone sample', async context => {
  const {root, catalog, draft} = await fixture(context);
  catalog.isolates[0]!.name = 'FGSC A4 mutant';
  catalog.isolates[1]!.name = 'fgsc-a4';
  const strain: AccessionEntry = {
    accession: 'GCF_000149205.2',
    ncbi: {organism: 'Example organism', strain: 'FGSC A4', retrieved_at: now.toISOString(), source: 'datasets-v2-rest'},
    cached_copies: [],
  };
  const prepared = buildReferenceConsensusRun(
    {...draft, backboneSource: 'ncbi', backboneAccession: 'GCF_000149205.2'},
    catalog,
    root,
    8,
    now,
  );
  const warnings = reviewWarnings(prepared, await inspectPreparedRun(prepared, {readAccessions: async () => [strain]}));
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]?.includes('(isolate-b)'));
});

test('refuses input paths Snakemake cannot declare', async context => {
  const {root, catalog, draft} = await fixture(context);
  const braced = join(root, 'reads', 'x{y}');
  await mkdir(braced);
  const pair = catalog.isolates[1]!.read_pairs[0]!;
  pair.r1 = join(braced, 'b_R1.fastq');
  await writeFile(pair.r1, fastq);
  const prepared = buildReferenceConsensusRun(draft, catalog, root, 8, now);
  await assert.rejects(
    inspectPreparedRun(prepared, {readAccessions: noAccessions}),
    error => issuesOf(error).some(issue => issue.path.includes("'isolate-b' pair 1 R1") && issue.message.includes('{')),
  );
});
