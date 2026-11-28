import assert from 'node:assert/strict';
import test from 'node:test';
import {genomeSelection, selectedGenome} from '../../src/accessions/selection.js';

const reference = {source: 'veupathdb', id: 'FungiDB-71_ExampleA', parameters: {site: 'FungiDB', release: 71, organism_abbreviation: 'ExampleA'}};

test('catalog selections snapshot only canonical identity and provider parameters', () => {
  const value = genomeSelection({...reference, name: 'local-label', metadata: {organism: 'not-a-parameter'}, secret: 'not-for-form-state'} as typeof reference);
  assert.deepEqual(JSON.parse(value), reference);
  assert.deepEqual(selectedGenome(value), reference);
  const reordered = {...reference, parameters: {organism_abbreviation: 'ExampleA', release: 71, site: 'FungiDB'}};
  assert.equal(genomeSelection(reordered), value);
});

test('direct NCBI identifiers are not workflow selections', () => {
  assert.equal(selectedGenome(' gcf_000000001.1 '), undefined);
  assert.equal(selectedGenome('GCF_000000001.1'), undefined);
});

test('invalid or incompatible selections never fall back to another provider', () => {
  for (const value of ['', reference.id, '{broken', JSON.stringify({...reference, secret: 'not-allowed'}),
    JSON.stringify({...reference, parameters: {...reference.parameters, release: 70}}),
    JSON.stringify({...reference, source: 'unknown'}), JSON.stringify({...reference, parameters: {...reference.parameters, 'api-key': 'not-allowed'}})]) {
    assert.equal(selectedGenome(value), undefined);
  }
});
