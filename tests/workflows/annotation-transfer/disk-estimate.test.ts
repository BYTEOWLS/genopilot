import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {annotationTransferDiskEstimate} from '../../../src/workflows/annotation-transfer/disk-estimate.js';
import {
  buildAnnotationTransferConfiguration,
  createAnnotationTransferDraft,
} from '../../../src/workflows/annotation-transfer/run-configuration.js';
import {parseWorkflowManifest} from '../../../src/workflows/manifest.js';
import {ncbiCacheDirectory} from '../../../src/workflows/run-preparation.js';

const genopilot = {version: '1.2.3', igv: '3.8.9'};
const factors = {target_genome_bytes: 4, reference_genome_bytes: 1, reference_annotation_bytes: 10};
/** Reads sizes from a map; a path not in it does not exist. */
function fileSizes(extra: Record<string, number> = {}): (path: string) => Promise<number> {
  const sizes: Record<string, number> = {
    '/data/reference.fa': 300,
    '/data/reference.gff3': 200,
    '/data/target.fa': 100,
    ...extra,
  };
  return async path => {
    const size = sizes[path];
    if (size === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return size;
  };
}

function localRun() {
  return buildAnnotationTransferConfiguration({
    ...createAnnotationTransferDraft('/data'),
    referenceFasta: 'reference.fa',
    referenceGff3: 'reference.gff3',
    targetFasta: 'target.fa',
    runName: 'Estimate',
  }, '/data', genopilot, 4);
}

test('estimates kept bytes from each input\'s size and factor, with no temporary files', async () => {
  const estimate = await annotationTransferDiskEstimate(factors, localRun(), fileSizes());
  // 4 × 100 target + 1 × 300 reference genome + 10 × 200 reference annotation.
  assert.deepEqual(estimate, {disk: {keptBytes: 2700, peakBytes: 2700}});
});

test('counts NCBI inputs from the download cache and names those not downloaded yet', async () => {
  const prepared = localRun();
  const outputRoot = prepared.configuration.run.output_root;
  const reference = {source: 'ncbi' as const, accession: 'GCF_000000001.1'};
  const target = {source: 'ncbi' as const, accession: 'GCA_000000002.1'};
  const ncbi = {...prepared, configuration: {...prepared.configuration, inputs: {reference, target}}};

  const none = await annotationTransferDiskEstimate(factors, ncbi, fileSizes());
  assert.equal(none.disk.keptBytes, 0);
  assert.ok(none.note?.includes('reference') && none.note.includes('target'));

  const cache = ncbiCacheDirectory(outputRoot, reference.accession);
  const withReference = await annotationTransferDiskEstimate(factors, ncbi, fileSizes({
    [join(cache, 'genomic.fna')]: 300,
    [join(cache, 'genomic.gff')]: 200,
  }));
  assert.equal(withReference.disk.keptBytes, 2300);
  assert.ok(withReference.note?.includes('target') && !withReference.note.includes('reference'));
});

test('reads the packaged manifest\'s factors and rejects missing or unknown ones', async () => {
  const manifest = parseWorkflowManifest(
    await readFile(new URL('../../../workflows/annotation-transfer/manifest.yaml', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.disk_estimate);
  assert.ok((await annotationTransferDiskEstimate(manifest.disk_estimate, localRun(), fileSizes())).disk.keptBytes > 0);
  const {reference_annotation_bytes: _left, ...missing} = factors;
  await assert.rejects(annotationTransferDiskEstimate(missing, localRun(), fileSizes()), /reference_annotation_bytes/);
  await assert.rejects(annotationTransferDiskEstimate({...factors, extra: 1}, localRun(), fileSizes()), /extra/);
});
