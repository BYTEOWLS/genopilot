import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {parseWorkflowManifest} from '../../../src/workflows/manifest.js';
import {
  estimateDisk,
  referenceConsensusDiskFactors,
  type ReferenceConsensusDiskFactors,
} from '../../../src/workflows/reference-consensus/disk-estimate.js';

const factors: ReferenceConsensusDiskFactors = {
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

test('reads the packaged manifest\'s factors, and rejects missing, unknown, or too few CPUs', async () => {
  const manifest = parseWorkflowManifest(
    await readFile(new URL('../../../workflows/reference-consensus/manifest.yaml', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.disk_estimate);
  assert.ok(referenceConsensusDiskFactors(manifest.disk_estimate).cpus_per_isolate >= 1);

  const {run_genome_bytes: _left, ...missing} = factors;
  assert.throws(() => referenceConsensusDiskFactors(missing), /run_genome_bytes/);
  assert.throws(() => referenceConsensusDiskFactors({...factors, extra: 1}), /extra/);
  assert.throws(() => referenceConsensusDiskFactors({...factors, cpus_per_isolate: 0}), /cpus_per_isolate/);
});
