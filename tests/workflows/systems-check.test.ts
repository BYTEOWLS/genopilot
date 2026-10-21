import assert from 'node:assert/strict';
import test from 'node:test';
import type {DiskEstimateFactors} from '../../src/workflows/manifest.js';
import {
  checkMachine,
  estimateDisk,
  formatBytes,
  formatMemory,
  systemsCheckReview,
} from '../../src/workflows/systems-check.js';

const factors: DiskEstimateFactors = {
  isolate_read_bytes: 0.5,
  isolate_genome_bytes: 9,
  run_genome_bytes: 3,
  temporary_read_bytes: 2,
  cpus_per_isolate: 8,
};

test('adds what each isolate and the run keep, and the temporary files of isolates processed at once', () => {
  const estimate = estimateDisk(factors, {isolateReadBytes: [1000, 3000, 2000], genomeBytes: 100, effectiveCpus: 16});
  // Kept: 0.5 × 6000 reads + 3 isolates × 9 × 100 + 3 × 100.
  assert.equal(estimate.keptBytes, 3000 + 2700 + 300);
  // Two isolates at once (16 ÷ 8): the two largest, 3000 and 2000 bytes of reads.
  assert.equal(estimate.peakBytes, 6000 + 2 * 5000);
});

test('processes at least one isolate at a time and leaves out a genome still to be downloaded', () => {
  const estimate = estimateDisk(factors, {isolateReadBytes: [1000, 3000], effectiveCpus: 2});
  assert.equal(estimate.keptBytes, 2000);
  assert.equal(estimate.peakBytes, 2000 + 2 * 3000);
  assert.deepEqual(estimateDisk(factors, {isolateReadBytes: [], genomeBytes: 100, effectiveCpus: 4}), {keptBytes: 300, peakBytes: 300});
});

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
