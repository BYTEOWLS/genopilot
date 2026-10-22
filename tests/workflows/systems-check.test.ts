import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {writeMachineRate} from '../../src/workflows/machine-rates.js';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';
import {
  checkMachine,
  checkRunSystem,
  formatBytes,
  formatMemory,
  formatRoughDuration,
  recordRunRate,
  recordsRunRates,
  systemsCheckReview,
  type SystemsCheckRun,
} from '../../src/workflows/systems-check.js';
import {testMachine} from './machine.js';

test('reads free space from the nearest existing folder of a run directory not created yet', async () => {
  const asked: string[] = [];
  const machine = await checkMachine('/data/runs/new-workflow/new-run', {
    readStatfs: (async (path: string) => {
      asked.push(path);
      if (path !== '/data') {
        throw Object.assign(new Error('missing'), {code: 'ENOENT'});
      }
      return {bavail: 10, bsize: 4096};
    }) as never,
    cpus: () => 12,
    installedMemory: () => 64e9,
  });
  assert.deepEqual(machine, {freeBytes: 40_960, availableCpus: 12, installedMemoryBytes: 64e9});
  assert.deepEqual(asked, ['/data/runs/new-workflow/new-run', '/data/runs/new-workflow', '/data/runs', '/data']);
});

test('warns with both numbers only when the peak exceeds the free space, and never without an estimate', () => {
  const machine = {freeBytes: 5e9, availableCpus: 8, installedMemoryBytes: 16e9};
  const fits = systemsCheckReview(machine, {disk: {keptBytes: 3e9, peakBytes: 4e9}});
  assert.deepEqual(fits.warnings, []);
  assert.ok(fits.rows.some(row => row.value.includes('3.0 GB') && row.value.includes('4.0 GB')));

  const tight = systemsCheckReview(machine, {disk: {keptBytes: 3e9, peakBytes: 6e9}, note: 'without the backbone'});
  assert.equal(tight.warnings.length, 1);
  assert.ok(tight.warnings[0]!.includes('6.0 GB') && tight.warnings[0]!.includes('5.0 GB'));
  assert.ok(tight.rows.some(row => row.value.includes('without the backbone')));

  assert.deepEqual(systemsCheckReview(machine).warnings, []);
  assert.deepEqual(systemsCheckReview({availableCpus: 8, installedMemoryBytes: 16e9}, {disk: {keptBytes: 1, peakBytes: 1e15}}).warnings, []);
});

test('formats installed memory in binary gigabytes, as the operating system reports it', () => {
  assert.equal(formatMemory(64 * 2 ** 30), '64 GB');
  assert.equal(formatMemory(17_179_869_184), '16 GB');
});

test('formats bytes in decimal units', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1_500_000), '1.5 MB');
  assert.equal(formatBytes(11e9), '11.0 GB');
  assert.equal(formatBytes(2.2e15), '2200.0 TB');
});

test('replaces the default disk estimate with a measured run and adds duration and memory', () => {
  const machine = {freeBytes: 100e9, availableCpus: 8, installedMemoryBytes: 16 * 2 ** 30};
  const measured = {
    runId: 'run-a',
    keptBytes: 20e9,
    durationSeconds: {low: 42 * 60, high: 90 * 60},
    effectiveCpus: 8,
    peakMemoryBytes: 6 * 2 ** 30,
  };
  const review = systemsCheckReview(machine, {disk: {keptBytes: 25e9, peakBytes: 30e9}, measured, effectiveCpus: 8});
  // Kept bytes from the measured run; the temporary 5 GB from the factors stay.
  assert.ok(review.rows.some(row => row.value.includes('20.0 GB') && row.value.includes('25.0 GB') && row.value.includes('run-a')));
  assert.ok(review.rows.some(row => row.value.includes('42 min') && row.value.includes('1 h 30 min')));
  assert.ok(review.rows.some(row => row.value.includes('6.0 GB')));
  assert.deepEqual(review.warnings, []);

  // A different CPU count is named, and a peak above the installed memory warns.
  const tight = systemsCheckReview(
    {...machine, installedMemoryBytes: 4 * 2 ** 30},
    {disk: {keptBytes: 25e9, peakBytes: 30e9}, measured, effectiveCpus: 4},
  );
  assert.ok(tight.rows.some(row => row.value.includes('8 CPUs') && row.value.includes('4')));
  assert.equal(tight.warnings.length, 1);
  assert.ok(tight.warnings[0]!.includes('6.0 GB') && tight.warnings[0]!.includes('4.0 GB'));
});

test('rounds an estimated duration to minutes, or hours and minutes', () => {
  assert.equal(formatRoughDuration(10), '1 min');
  assert.equal(formatRoughDuration(42 * 60 + 20), '42 min');
  assert.equal(formatRoughDuration(3 * 3600 + 5 * 60), '3 h 5 min');
});

const manifest: WorkflowManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'workflow-a',
  label: 'Workflow A',
  description: 'A workflow.',
  entry_snakefile: 'Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [],
  artifacts: [],
  disk_estimate: {kept_per_input_byte: 2},
};

const run: SystemsCheckRun = {
  runId: 'run-b',
  outputDirectory: '/runs/run-b',
  machine: testMachine,
  effectiveCpus: 8,
  // The workflow's own estimate from its factors: 2 × 1600 input bytes.
  diskEstimate: async factors => {
    const keptBytes = (factors.kept_per_input_byte ?? 0) * 1600;
    return {disk: {keptBytes, peakBytes: keptBytes}};
  },
};

const machine = {freeBytes: 100e9, availableCpus: 8, installedMemoryBytes: 16 * 2 ** 30};

async function tempDir(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'systems-check-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

test('checks any workflow\'s run: the machine only without disk factors, with estimates when declared', async context => {
  const ratesPath = join(await tempDir(context), 'machine-rates.yaml');
  const check = async () => machine;
  const labels = async (checkedManifest: WorkflowManifest | undefined, checkedRun: SystemsCheckRun) =>
    (await checkRunSystem(checkedManifest, checkedRun, {check, ratesPath})).rows.map(row => row.value);

  const machineOnly = (await labels(undefined, run)).length;
  assert.equal((await labels({...manifest, disk_estimate: undefined}, run)).length, machineOnly);
  assert.equal((await labels(manifest, {...run, diskEstimate: undefined})).length, machineOnly);
  // The default estimate, then a rate measured on this machine adds its duration.
  assert.ok((await labels(manifest, run)).some(value => value.startsWith('3.2 kB') && !value.includes('while running')));
  await writeMachineRate(ratesPath, 'workflow-a', {
    machine: testMachine, run: {id: 'run-a', directory: '/runs/run-a'}, effective_cpus: 8,
    estimated_bytes: 3200, kept_bytes: 6400, duration_seconds: 600,
  });
  const measured = await labels(manifest, run);
  assert.ok(measured.some(value => value.startsWith('6.4 kB') && value.includes('run-a')));
  assert.ok(measured.some(value => value.includes('7 min') && value.includes('15 min')));
  // Another machine's rate is not used.
  assert.ok(!(await labels(manifest, {...run, machine: {...testMachine, cpus: 2}})).some(value => value.includes('run-a')));
});

test('records nothing for a workflow without disk factors, and turns a failed measurement into a note', async context => {
  const ratesPath = join(await tempDir(context), 'machine-rates.yaml');
  assert.equal(await recordRunRate({...manifest, disk_estimate: undefined}, run, ratesPath), undefined);
  const note = await recordRunRate(manifest, {...run, diskEstimate: async () => {
    throw new Error('size-failure-message');
  }}, ratesPath);
  assert.ok(note?.includes('size-failure-message'));
});

test('warns instead of failing when the workflow\'s disk estimate fails', async () => {
  const review = await checkRunSystem(manifest, {...run, diskEstimate: async () => {
    throw new Error('factor-failure-message');
  }}, {check: async () => machine, ratesPath: '/nonexistent/machine-rates.yaml'});
  assert.equal(review.rows.length, (await checkRunSystem(undefined, run, {check: async () => machine})).rows.length);
  assert.equal(review.warnings.length, 1);
  assert.ok(review.warnings[0]!.includes('factor-failure-message'));
});

test('measures completed runs only of a workflow with disk factors', () => {
  assert.equal(recordsRunRates(manifest), true);
  assert.equal(recordsRunRates({...manifest, disk_estimate: undefined}), false);
  assert.equal(recordsRunRates(undefined), false);
});
