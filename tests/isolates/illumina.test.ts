import assert from 'node:assert/strict';
import test from 'node:test';
import {illuminaCompatibility, resolveIlluminaPreprocessing} from '../../src/isolates/illumina/metadata.js';
import {testReadSet} from '../read-sets.js';

const pair = {r1: '/reads/r1.fq', r2: '/reads/r2.fq', trimmed: false};

test('resolves Auto by reviewed chemistry without guessing from platform or filenames', () => {
  for (const chemistry of ['two-colour', 'four-colour'] as const) {
    const set = testReadSet([pair], {illumina: {chemistry, poly_g: 'auto'}});
    const resolved = resolveIlluminaPreprocessing(set);
    assert.equal(resolved.poly_g, chemistry === 'two-colour');
    assert.equal(resolved.poly_g_source, 'chemistry');
    assert.equal(resolved.minimum_length, 30);
    assert.equal(resolved.quality_filtering, false);
  }
  for (const chemistry of ['one-channel', 'unknown'] as const) {
    const unresolved = testReadSet([pair], {illumina: {chemistry, poly_g: 'auto'}});
    assert.ok(illuminaCompatibility(unresolved).length > 0);
    assert.throws(() => resolveIlluminaPreprocessing(unresolved));
    for (const poly_g of ['on', 'off'] as const) {
      const resolved = resolveIlluminaPreprocessing({...unresolved, illumina: {chemistry, poly_g}});
      assert.equal(resolved.poly_g, poly_g === 'on');
      assert.equal(resolved.poly_g_source, 'explicit');
    }
  }
});

test('unknown previous processing blocks execution; known trimmed groups need no chemistry guess', () => {
  assert.ok(illuminaCompatibility(testReadSet([{...pair, trimmed: null}])).length > 0);
  for (const chemistry of ['one-channel', 'unknown'] as const) {
    const provider = testReadSet([{...pair, trimmed: true}], {illumina: {chemistry, poly_g: 'auto'}});
    assert.deepEqual(illuminaCompatibility(provider), []);
    assert.doesNotThrow(() => resolveIlluminaPreprocessing(provider));
    provider.read_pairs.push(pair);
    assert.ok(illuminaCompatibility(provider).length > 0);
  }
  assert.ok(illuminaCompatibility(testReadSet([pair], {library_id: ''})).length > 0);
});

test('compatibility explains unsupported technology/layout without enabling execution', () => {
  const unsupported = {...testReadSet([pair]), platform: 'nanopore', layout: 'single-end'};
  const reasons = illuminaCompatibility(unsupported as ReturnType<typeof testReadSet>);
  assert.equal(reasons.length, 2);
  assert.throws(() => resolveIlluminaPreprocessing(unsupported as ReturnType<typeof testReadSet>));
});
