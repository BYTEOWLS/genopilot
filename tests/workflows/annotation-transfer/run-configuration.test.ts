import assert from 'node:assert/strict';
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
  applyNcbiCacheModes,
  discoverAnnotationTransferRuns,
  effectiveCpuCount,
  findNcbiCacheEntries,
  buildAnnotationTransferRunId,
  formatRunTimestampPrefix,
  sanitizeRunIdSuffix,
  savePreparedRun,
  validatePreparedRunPaths,
} from '../../../src/workflows/annotation-transfer/run-configuration.js';

const now = new Date('2026-09-05T08:34:12.123Z');
const runTimestampPrefix = '2026-09-05_083412123_';

async function fixture(): Promise<{
  root: string;
  draft: ReturnType<typeof createAnnotationTransferDraft>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'annotation-transfer-form-'));
  const runs = join(root, 'runs');
  await mkdir(runs);
  for (const name of ['reference.fa', 'reference.gff3', 'target.fa']) {
    await writeFile(join(root, name), 'fixture\n');
  }
  return {
    root,
    draft: {
      ...createAnnotationTransferDraft(root),
      referenceFasta: 'reference.fa',
      referenceGff3: 'reference.gff3',
      targetFasta: 'target.fa',
      runName: 'Baseline transfer',
    },
  };
}

test('resolves draft paths and records requested and effective options', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.cpuMode = 'manual';
  draft.manualCpuLimit = '8';
  draft.runDescription = '  Initial T2T annotation  ';

  const prepared = buildAnnotationTransferConfiguration(draft, root, 4, now);

  assert.deepEqual(prepared.configuration.inputs.reference, {
    source: 'local',
    fasta: join(root, 'reference.fa'),
    gff3: join(root, 'reference.gff3'),
  });
  assert.deepEqual(prepared.configuration.inputs.target, {
    source: 'local',
    fasta: join(root, 'target.fa'),
  });
  assert.deepEqual(prepared.configuration.lifton, {profile: 'same-species'});
  assert.deepEqual(prepared.configuration.resources, {
    cpu_mode: 'manual',
    manual_limit: 8,
    effective_cpus: 4,
  });
  assert.equal(prepared.configuration.run.description, 'Initial T2T annotation');
  assert.equal(prepared.configuration.run.name, 'Baseline transfer');
  assert.equal(prepared.configuration.run.id, `${runTimestampPrefix}Baseline-transfer`);
  assert.equal(prepared.configuration.run.created_at, now.toISOString());
  assert.equal(
    prepared.outputDirectory,
    join(root, 'runs', 'annotation-transfer', `${runTimestampPrefix}Baseline-transfer`),
  );
});

test('resolves an NCBI accession source independently for the reference and the target', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.referenceSource = 'ncbi';
  // Pasted with surrounding whitespace and typed in lowercase.
  draft.referenceAccession = '  gcf_000149205.2  ';
  draft.targetSource = 'local';

  const prepared = buildAnnotationTransferConfiguration(draft, root, 4);

  assert.deepEqual(prepared.configuration.inputs.reference, {
    source: 'ncbi',
    accession: 'GCF_000149205.2',
    ncbi_cache_mode: 'reuse',
  });
  assert.deepEqual(prepared.configuration.inputs.target, {
    source: 'local',
    fasta: join(root, 'target.fa'),
  });
});

test('finds existing accession caches and applies explicit cache modes', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.referenceSource = 'ncbi';
  draft.referenceAccession = 'GCF_000149205.2';
  draft.targetSource = 'ncbi';
  draft.targetAccession = 'GCA_000149205.2';
  const prepared = buildAnnotationTransferConfiguration(draft, root, 4, now);
  await mkdir(join(root, 'runs', 'ncbi-accessions-cache', 'GCF_000149205.2'), {recursive: true});

  assert.deepEqual(await findNcbiCacheEntries(prepared), [
    {input: 'reference', accession: 'GCF_000149205.2'},
  ]);

  const decided = applyNcbiCacheModes(prepared, {reference: 'refresh'});
  assert.equal(
    decided.configuration.inputs.reference.source === 'ncbi'
      ? decided.configuration.inputs.reference.ncbi_cache_mode
      : undefined,
    'refresh',
  );
  assert.equal(
    decided.configuration.inputs.target.source === 'ncbi'
      ? decided.configuration.inputs.target.ncbi_cache_mode
      : undefined,
    'reuse',
  );
});

test('rejects inaccessible or malformed accession cache entries', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.referenceSource = 'ncbi';
  draft.referenceAccession = 'GCF_000149205.2';
  const prepared = buildAnnotationTransferConfiguration(draft, root, 4, now);

  await assert.rejects(
    findNcbiCacheEntries(prepared, async () => {
      throw Object.assign(new Error('permission denied'), {code: 'EACCES'});
    }),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      assert.equal(error.issues[0]?.path, '$.inputs.reference.ncbi_cache_mode');
      assert.match(error.issues[0]?.message ?? '', /cannot be accessed/);
      return true;
    },
  );

  await assert.rejects(
    findNcbiCacheEntries(prepared, async () => ({
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

  const blank = buildAnnotationTransferConfiguration(draft, '/research', 4, now);
  assert.equal(blank.configuration.run.id, `${runTimestampPrefix}annotation-transfer`);
  assert.ok(!('name' in blank.configuration.run));
  assert.equal(blank.configuration.run.created_at, now.toISOString());

  draft.runName = '  Baseline transfer  ';
  const named = buildAnnotationTransferConfiguration(draft, '/research', 4, now);
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
  const prepared = buildAnnotationTransferConfiguration(draft, '/research', 4, now);

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
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.targetFasta = 'missing.fa';
  const prepared = buildAnnotationTransferConfiguration(draft, root, 4);
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

test('does not check the filesystem for an NCBI-sourced input', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.referenceSource = 'ncbi';
  draft.referenceAccession = 'GCF_000149205.2';
  const prepared = buildAnnotationTransferConfiguration(draft, root, 4);

  await validatePreparedRunPaths(prepared, undefined, async () => []);
});

test('refuses an NCBI accession whose cataloged copies conflict', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  draft.referenceSource = 'ncbi';
  draft.referenceAccession = 'GCF_000149205.2';
  draft.targetSource = 'ncbi';
  draft.targetAccession = 'GCA_000011425.1';
  const prepared = buildAnnotationTransferConfiguration(draft, root, 4);
  const copy = (path: string, checksum: string) =>
    ({path, verified_at: '2026-01-01T00:00:00.000Z', fasta_sha256: checksum.repeat(64)});
  const catalog = async () => [
    {
      accession: 'GCF_000149205.2',
      ncbi: null,
      cached_copies: [copy('/a/GCF_000149205.2', 'a'), copy('/b/GCF_000149205.2', 'b')],
    },
    {
      accession: 'GCA_000011425.1',
      ncbi: null,
      cached_copies: [copy('/a/GCA_000011425.1', 'c'), copy('/b/GCA_000011425.1', 'c')],
    },
  ];

  await assert.rejects(
    validatePreparedRunPaths(prepared, undefined, catalog),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      // Only the reference conflicts; the target's copies agree.
      assert.deepEqual(error.issues.map(issue => issue.path), ['$.inputs.reference.accession']);
      return true;
    },
  );
  // An unreadable catalog does not block the run.
  await validatePreparedRunPaths(prepared, undefined, async () => {
    throw new Error('catalog is broken');
  });
});

test('atomically saves a complete configuration without overwriting a run', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const prepared = buildAnnotationTransferConfiguration(draft, root, 4, now);

  const configurationPath = await savePreparedRun(prepared);
  const saved = parseAnnotationTransferConfiguration(await readFile(configurationPath, 'utf8'));

  assert.equal(saved.run.name, 'Baseline transfer');
  assert.equal(saved.run.id, `${runTimestampPrefix}Baseline-transfer`);
  assert.equal(saved.run.created_at, now.toISOString());
  assert.equal(saved.resources.effective_cpus, 4);
  await assert.rejects(savePreparedRun(prepared), AnnotationTransferConfigurationError);
});

test('saves strings that a YAML 1.1 loader such as Snakemake keeps as strings', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const prepared = buildAnnotationTransferConfiguration({...draft, runName: 'no'}, root, 4, now);

  const configurationPath = await savePreparedRun(prepared);
  const yaml11 = parse(await readFile(configurationPath, 'utf8'), {version: '1.1'});

  assert.deepEqual(yaml11, prepared.configuration);
  assert.equal(yaml11.run.created_at, now.toISOString());
  assert.equal(yaml11.run.name, 'no');
});

test('returns no runs when the workflow has never been run', async context => {
  const root = await mkdtemp(join(tmpdir(), 'annotation-transfer-history-'));
  context.after(() => rm(root, {recursive: true, force: true}));

  assert.deepEqual(await discoverAnnotationTransferRuns(join(root, 'runs')), []);
});

test('discovers saved runs newest first and skips an unreadable one', async context => {
  const {root, draft} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));

  await savePreparedRun(
    buildAnnotationTransferConfiguration(draft, root, 4, new Date('2026-09-01T08:00:00.000Z')),
  );
  await savePreparedRun(
    buildAnnotationTransferConfiguration(
      {...draft, runName: 'Second run'},
      root,
      4,
      new Date('2026-09-02T08:00:00.000Z'),
    ),
  );
  const corruptDirectory = join(root, 'runs', 'annotation-transfer', 'corrupt');
  await mkdir(corruptDirectory, {recursive: true});
  await writeFile(join(corruptDirectory, 'config.yaml'), 'not: [valid');

  const runs = await discoverAnnotationTransferRuns(join(root, 'runs'));

  assert.deepEqual(
    runs.map(run => run.configuration.run.id),
    ['2026-09-02_080000000_Second-run', '2026-09-01_080000000_Baseline-transfer'],
  );
});
