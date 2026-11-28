import assert from 'node:assert/strict';
import {ncbiSelection, downloadedNcbiGenome} from '../../genomes.js';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';
import {
  AnnotationTransferConfigurationError,
  parseAnnotationTransferConfiguration,
} from '../../../src/workflows/annotation-transfer/configuration.js';
import {
  buildAnnotationTransferConfiguration,
  createAnnotationTransferDraft,
  applyGenomeCacheModes,
  discoverAnnotationTransferRuns,
  effectiveCpuCount,
  findGenomeCacheEntries,
  buildAnnotationTransferRunId,
  formatRunTimestampPrefix,
  sanitizeRunIdSuffix,
  savePreparedRun,
  validatePreparedRunPaths,
} from '../../../src/workflows/annotation-transfer/run-configuration.js';
import {machineDetails} from '../../../src/workflows/configuration-validation.js';

const now = new Date('2026-09-05T08:34:12.123Z');
const genopilot = {version: '1.2.3', igv: '3.8.9'};
const runTimestampPrefix = '2026-09-05_083412123_';

async function fixture(): Promise<{
  tempDir: string;
  draft: ReturnType<typeof createAnnotationTransferDraft>;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'annotation-transfer-form-'));
  const runs = join(tempDir, 'runs');
  await mkdir(runs);
  for (const name of ['reference.fa', 'reference.gff3', 'target.fa']) {
    await writeFile(join(tempDir, name), 'fixture\n');
  }
  return {
    tempDir,
    draft: {
      ...createAnnotationTransferDraft(tempDir),
      referenceFasta: 'reference.fa',
      referenceGff3: 'reference.gff3',
      targetFasta: 'target.fa',
      runName: 'Baseline transfer',
    },
  };
}

test('resolves draft paths and records requested and effective options', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.cpuMode = 'manual';
  draft.manualCpuLimit = '8';
  draft.runDescription = '  Initial T2T annotation  ';

  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4, now);

  assert.deepEqual(prepared.configuration.inputs.reference, {
    source: 'local',
    fasta: join(tempDir, 'reference.fa'),
    gff3: join(tempDir, 'reference.gff3'),
  });
  assert.deepEqual(prepared.configuration.inputs.target, {
    source: 'local',
    fasta: join(tempDir, 'target.fa'),
  });
  assert.deepEqual(prepared.configuration.lifton, {profile: 'same-species'});
  assert.deepEqual(prepared.configuration.genopilot, genopilot);
  assert.deepEqual(prepared.configuration.resources, {
    cpu_mode: 'manual',
    manual_limit: 8,
    effective_cpus: 4,
    machine: machineDetails(),
  });
  assert.equal(prepared.configuration.run.description, 'Initial T2T annotation');
  assert.equal(prepared.configuration.run.name, 'Baseline transfer');
  assert.equal(prepared.configuration.run.id, `${runTimestampPrefix}Baseline-transfer`);
  assert.equal(prepared.configuration.run.created_at, now.toISOString());
  assert.equal(
    prepared.outputDirectory,
    join(tempDir, 'runs', 'annotation-transfer', `${runTimestampPrefix}Baseline-transfer`),
  );
});

test('resolves an NCBI accession source independently for the reference and the target', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.referenceSource = 'remote';
  draft.referenceAccession = ncbiSelection('GCF_000149205.2');
  draft.targetSource = 'local';

  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4);

  assert.deepEqual(prepared.configuration.inputs.reference, {
    source: 'remote', reference: {source: 'ncbi', id: 'GCF_000149205.2', parameters: {}},
    cache_mode: 'reuse',
  });
  assert.deepEqual(prepared.configuration.inputs.target, {
    source: 'local',
    fasta: join(tempDir, 'target.fa'),
  });
});

test('finds existing accession caches and applies explicit cache modes', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.referenceSource = 'remote';
  draft.referenceAccession = ncbiSelection('GCF_000149205.2');
  draft.targetSource = 'remote';
  draft.targetAccession = ncbiSelection('GCA_000149205.2');
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4, now);
  await mkdir(join(tempDir, 'runs', 'ncbi-accessions-cache', 'GCF_000149205.2'), {recursive: true});

  assert.deepEqual(await findGenomeCacheEntries(prepared), [
    {input: 'reference', id: 'GCF_000149205.2'},
  ]);

  const decided = applyGenomeCacheModes(prepared, {reference: 'refresh'});
  assert.equal(
    decided.configuration.inputs.reference.source === 'remote'
      ? decided.configuration.inputs.reference.cache_mode
      : undefined,
    'refresh',
  );
  assert.equal(
    decided.configuration.inputs.target.source === 'remote'
      ? decided.configuration.inputs.target.cache_mode
      : undefined,
    'reuse',
  );
});

test('rejects inaccessible or malformed accession cache entries', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.referenceSource = 'remote';
  draft.referenceAccession = ncbiSelection('GCF_000149205.2');
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4, now);

  await assert.rejects(
    findGenomeCacheEntries(prepared, async () => {
      throw Object.assign(new Error('permission denied'), {code: 'EACCES'});
    }),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      assert.equal(error.issues[0]?.path, '$.inputs.reference.cache_mode');
      assert.match(error.issues[0]?.message ?? '', /cannot be accessed/);
      return true;
    },
  );

  await assert.rejects(
    findGenomeCacheEntries(prepared, async () => ({
      isFile: () => true,
      isDirectory: () => false,
    })),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      assert.match(error.issues[0]?.message ?? '', /must be a directory/);
      return true;
    },
  );
});

test('always builds a timestamped run ID and keeps the optional name verbatim', () => {
  assert.equal(formatRunTimestampPrefix(now), runTimestampPrefix);
  assert.equal(
    buildAnnotationTransferRunId('', now),
    `${runTimestampPrefix}annotation-transfer`,
  );

  const draft = createAnnotationTransferDraft('/research');
  assert.equal(draft.runName, '');
  draft.referenceFasta = '/data/reference.fa';
  draft.referenceGff3 = '/data/reference.gff3';
  draft.targetFasta = '/data/target.fa';

  const blank = buildAnnotationTransferConfiguration(draft, '/research', genopilot, 4, now);
  assert.equal(blank.configuration.run.id, `${runTimestampPrefix}annotation-transfer`);
  assert.ok(!('name' in blank.configuration.run));
  assert.equal(blank.configuration.run.created_at, now.toISOString());

  draft.runName = '  Baseline transfer  ';
  const named = buildAnnotationTransferConfiguration(draft, '/research', genopilot, 4, now);
  assert.equal(named.configuration.run.name, 'Baseline transfer');
  assert.equal(named.configuration.run.id, `${runTimestampPrefix}Baseline-transfer`);
});

test('derives a safe run-ID suffix without changing the stored run name', () => {
  assert.equal(sanitizeRunIdSuffix('Baseline transfer'), 'Baseline-transfer');
  assert.equal(sanitizeRunIdSuffix('re-run: T2T/2026 (final)'), 're-run-T2T-2026-final');
  assert.equal(sanitizeRunIdSuffix('...'), '');
  assert.equal(sanitizeRunIdSuffix('n'.repeat(80)), 'n'.repeat(60));
  // The length cap must not leave a separator dangling at the end of a directory name.
  assert.equal(sanitizeRunIdSuffix(`${'n'.repeat(59)} tail`), 'n'.repeat(59));

  const draft = {
    ...createAnnotationTransferDraft('/research'),
    referenceFasta: '/data/reference.fa',
    referenceGff3: '/data/reference.gff3',
    targetFasta: '/data/target.fa',
    runName: '  ../escape attempt  ',
  };
  const prepared = buildAnnotationTransferConfiguration(draft, '/research', genopilot, 4, now);

  assert.equal(prepared.configuration.run.name, '../escape attempt');
  assert.equal(prepared.configuration.run.id, `${runTimestampPrefix}escape-attempt`);
  assert.equal(
    prepared.outputDirectory,
    join('/research', 'runs', 'annotation-transfer', `${runTimestampPrefix}escape-attempt`),
  );
});

test('calculates every CPU allocation mode with at least one effective CPU', () => {
  assert.equal(effectiveCpuCount('automatic', '', 8), 8);
  assert.equal(effectiveCpuCount('leave-one-free', '', 8), 7);
  assert.equal(effectiveCpuCount('leave-one-free', '', 1), 1);
  assert.equal(effectiveCpuCount('manual', '12', 8), 8);
  assert.equal(effectiveCpuCount('manual', 'invalid', 8), 0);
});

test('reports missing inputs and an existing run before saving', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.targetFasta = 'missing.fa';
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4);
  await mkdir(prepared.outputDirectory, {recursive: true});

  await assert.rejects(
    validatePreparedRunPaths(prepared),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      const paths = error.issues.map(issue => issue.path);
      assert.ok(paths.includes('$.inputs.target.fasta'));
      assert.ok(paths.includes('$.run.id'));
      return true;
    },
  );
});

test('drafts reject typed genome identifiers for either remote role', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  for (const remote of [{referenceSource: 'remote' as const, referenceAccession: 'GCF_000149205.2'},
    {targetSource: 'remote' as const, targetAccession: 'GCF_000149205.2'}]) {
    assert.throws(() => buildAnnotationTransferConfiguration({...draft, ...remote}, tempDir, genopilot, 4), AnnotationTransferConfigurationError);
  }
});

test('requires a downloaded reference with both genomic FASTA and annotation', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.referenceSource = 'remote';
  draft.referenceAccession = ncbiSelection('GCF_000149205.2');
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4);

  for (const entries of [[], [{...downloadedNcbiGenome('GCF_000149205.2'), cached_copies: []}],
    [{...downloadedNcbiGenome('GCF_000149205.2'), cached_copies: [{...downloadedNcbiGenome('GCF_000149205.2').cached_copies[0]!, gff3_sha256: undefined}]}]]) {
    await assert.rejects(validatePreparedRunPaths(prepared, undefined, async () => entries), AnnotationTransferConfigurationError);
  }
  await validatePreparedRunPaths(prepared, undefined, async () => [downloadedNcbiGenome('GCF_000149205.2')]);
});

test('refuses an NCBI accession whose cataloged copies conflict', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.referenceSource = 'remote';
  draft.referenceAccession = ncbiSelection('GCF_000149205.2');
  draft.targetSource = 'remote';
  draft.targetAccession = ncbiSelection('GCA_000011425.1');
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4);
  const copy = (path: string, checksum: string) =>
    ({path, verified_at: '2026-01-01T00:00:00.000Z', fasta_sha256: checksum.repeat(64)});
  const catalog = async () => [
    {
      source: 'ncbi', id: 'GCF_000149205.2', parameters: {},
      metadata: null,
      cached_copies: [copy('/a/GCF_000149205.2', 'a'), copy('/b/GCF_000149205.2', 'b')],
    },
    {
      source: 'ncbi', id: 'GCA_000011425.1', parameters: {},
      metadata: null,
      cached_copies: [copy('/a/GCA_000011425.1', 'c'), copy('/b/GCA_000011425.1', 'c')],
    },
  ];

  await assert.rejects(
    validatePreparedRunPaths(prepared, undefined, catalog),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      // Only the reference conflicts; the target's copies agree.
      assert.deepEqual(error.issues.map(issue => issue.path), ['$.inputs.reference.reference']);
      return true;
    },
  );
  // An unreadable catalog cannot establish a downloaded reference.
  await assert.rejects(validatePreparedRunPaths(prepared, undefined, async () => {
    throw new Error('catalog is broken');
  }), AnnotationTransferConfigurationError);
});

test('atomically saves a complete configuration without overwriting a run', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4, now);

  const configurationPath = await savePreparedRun(prepared);
  const saved = parseAnnotationTransferConfiguration(await readFile(configurationPath, 'utf8'));

  assert.equal(saved.run.name, 'Baseline transfer');
  assert.equal(saved.run.id, `${runTimestampPrefix}Baseline-transfer`);
  assert.equal(saved.run.created_at, now.toISOString());
  assert.equal(saved.resources.effective_cpus, 4);
  await assert.rejects(savePreparedRun(prepared), AnnotationTransferConfigurationError);
});

test('saves strings that a YAML 1.1 loader such as Snakemake keeps as strings', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const prepared = buildAnnotationTransferConfiguration({...draft, runName: 'no'}, tempDir, genopilot, 4, now);

  const configurationPath = await savePreparedRun(prepared);
  const yaml11 = parse(await readFile(configurationPath, 'utf8'), {version: '1.1'});

  assert.deepEqual(yaml11, prepared.configuration);
  assert.equal(yaml11.run.created_at, now.toISOString());
  assert.equal(yaml11.run.name, 'no');
});

test('returns no runs when the workflow has never been run', async context => {
  const tempDir = await mkdtemp(join(tmpdir(), 'annotation-transfer-history-'));
  context.after(() => rm(tempDir, {recursive: true, force: true}));

  assert.deepEqual(await discoverAnnotationTransferRuns(join(tempDir, 'runs')), []);
});

test('discovers saved runs newest first and skips an unreadable one', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));

  await savePreparedRun(
    buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4, new Date('2026-09-01T08:00:00.000Z')),
  );
  await savePreparedRun(
    buildAnnotationTransferConfiguration(
      {...draft, runName: 'Second run'},
      tempDir,
      genopilot,
      4,
      new Date('2026-09-02T08:00:00.000Z'),
    ),
  );
  const corruptDirectory = join(tempDir, 'runs', 'annotation-transfer', 'corrupt');
  await mkdir(corruptDirectory, {recursive: true});
  await writeFile(join(corruptDirectory, 'config.yaml'), 'not: [valid');

  const runs = await discoverAnnotationTransferRuns(join(tempDir, 'runs'));

  assert.deepEqual(
    runs.map(run => run.configuration.run.id),
    ['2026-09-02_080000000_Second-run', '2026-09-01_080000000_Baseline-transfer'],
  );
});

test('saves cross-root provider snapshots with the files required by each role', async context => {
  const {tempDir, draft} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  draft.referenceSource = 'remote';
  draft.targetSource = 'remote';
  draft.referenceAccession = draft.targetAccession = ncbiSelection('GCF_000000001.1');
  const prepared = buildAnnotationTransferConfiguration(draft, tempDir, genopilot, 4, now);
  const single = {path: '/elsewhere/sequence/GCF_000000001.1', verified_at: now.toISOString(), fasta_sha256: 'a'.repeat(64)};
  const both = {...single, path: '/elsewhere/both/GCF_000000001.1', gff3_sha256: 'b'.repeat(64)};
  const readAccessions = async () => [{
    source: 'ncbi', id: 'GCF_000000001.1', parameters: {}, metadata: null,
    cached_copies: [single, both],
  }];
  const saved = parseAnnotationTransferConfiguration(await readFile(await savePreparedRun(prepared, undefined, readAccessions), 'utf8'));
  assert.equal(saved.schema_version, 2);
  assert.equal(saved.inputs.reference.source, 'remote');
  assert.equal(saved.inputs.target.source, 'remote');
  if (saved.inputs.reference.source === 'remote' && saved.inputs.target.source === 'remote') {
    assert.deepEqual(saved.inputs.reference.copy, {path: both.path, fasta_sha256: both.fasta_sha256, gff3_sha256: both.gff3_sha256});
    assert.deepEqual(saved.inputs.target.copy, {path: single.path, fasta_sha256: single.fasta_sha256});
    assert.deepEqual(saved.inputs.reference.reference, {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}});
  }
  assert.equal(await findGenomeCacheEntries(prepared).then(entries => entries.length), 2);
  const refresh = applyGenomeCacheModes(prepared, {reference: 'refresh'});
  assert.equal(refresh.configuration.inputs.reference.source === 'remote' ? refresh.configuration.inputs.reference.copy : undefined, undefined);
});
