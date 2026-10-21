import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {
  directoryBytes,
  estimateFromRate,
  rateForMachine,
  readMachineRates,
  recordMachineRate,
  writeMachineRate,
  type MachineRate,
} from '../../src/workflows/machine-rates.js';
import {appendExecutionRecord} from '../../src/workflows/run-timing.js';
import {testMachine} from './machine.js';

async function tempDir(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'machine-rates-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

const rate: MachineRate = {
  machine: testMachine,
  run: {id: 'run-a', directory: '/runs/run-a'},
  effective_cpus: 8,
  estimated_bytes: 10e9,
  kept_bytes: 8e9,
  duration_seconds: 3600,
  peak_memory_bytes: 6e9,
};

test('keeps the latest rate per workflow and skips malformed entries', async context => {
  const path = join(await tempDir(context), 'machine-rates.yaml');
  assert.deepEqual(await readMachineRates(path), {});
  await writeMachineRate(path, 'workflow-a', rate);
  await writeMachineRate(path, 'workflow-b', {...rate, run: {id: 'run-b', directory: '/runs/run-b'}});
  await writeMachineRate(path, 'workflow-a', {...rate, run: {id: 'run-c', directory: '/runs/run-c'}});
  const rates = await readMachineRates(path);
  assert.deepEqual(Object.keys(rates).sort(), ['workflow-a', 'workflow-b']);
  assert.equal(rates['workflow-a']?.run.id, 'run-c');

  await writeFile(path, `${await readFile(path, 'utf8')}broken:\n  kept_bytes: lots\n`);
  assert.deepEqual(Object.keys(await readMachineRates(path)).sort(), ['workflow-a', 'workflow-b']);
});

test('uses a rate only on the machine that measured it', () => {
  const rates = {'workflow-a': rate};
  assert.equal(rateForMachine(rates, 'workflow-a', testMachine), rate);
  assert.equal(rateForMachine(rates, 'workflow-a', {...testMachine, cpus: 16}), undefined);
  assert.equal(rateForMachine(rates, 'workflow-b', testMachine), undefined);
});

test('scales a measured run by the new run\'s default estimate, with a duration range', () => {
  const estimate = estimateFromRate(rate, 20e9);
  assert.equal(estimate.keptBytes, 16e9);
  assert.deepEqual(estimate.durationSeconds, {low: 7200 * 0.7, high: 7200 * 1.5});
  assert.equal(estimate.peakMemoryBytes, 6e9);
  assert.equal(estimate.runId, 'run-a');
});

test('measures a completed run from its directory and recorded timing', async context => {
  const directory = await tempDir(context);
  const runDirectory = join(directory, 'run-a');
  await mkdir(join(runDirectory, 'results'), {recursive: true});
  await writeFile(join(runDirectory, 'results', 'data.bin'), Buffer.alloc(1000));
  const ratesPath = join(directory, 'machine-rates.yaml');
  const measure = () => recordMachineRate({
    ratesPath, workflowId: 'workflow-a', runId: 'run-a', runDirectory, machine: testMachine, effectiveCpus: 4, estimatedBytes: 5000,
  });

  // A run without recorded timing or job times is not measured.
  await measure();
  assert.deepEqual(await readMachineRates(ratesPath), {});
  const withoutJobs = join(directory, 'run-without-jobs');
  await mkdir(withoutJobs);
  await appendExecutionRecord(withoutJobs, {
    started_at: '2026-10-21T08:00:00.000Z', finished_at: '2026-10-21T08:00:05.000Z', duration_seconds: 5,
    command: 'snakemake', stages: {},
  });
  await recordMachineRate({
    ratesPath, workflowId: 'workflow-a', runId: 'run-b', runDirectory: withoutJobs, machine: testMachine, effectiveCpus: 4, estimatedBytes: 5000,
  });
  assert.deepEqual(await readMachineRates(ratesPath), {});

  // Ten minutes in Snakemake, of which the jobs ran for six: the rest created Conda environments.
  await appendExecutionRecord(runDirectory, {
    started_at: '2026-10-21T08:00:00.000Z', finished_at: '2026-10-21T08:10:00.000Z', duration_seconds: 600,
    exit_code: 0, command: 'snakemake', stages: {align: 300, vote: 60}, peak_memory_bytes: 2e9,
  });
  await measure();
  const stored = (await readMachineRates(ratesPath))['workflow-a'];
  assert.equal(stored?.kept_bytes, await directoryBytes(runDirectory));
  assert.ok((stored?.kept_bytes ?? 0) > 1000);
  assert.deepEqual(
    {cpus: stored?.effective_cpus, estimated: stored?.estimated_bytes, seconds: stored?.duration_seconds, memory: stored?.peak_memory_bytes},
    {cpus: 4, estimated: 5000, seconds: 360, memory: 2e9},
  );
});
