import type {ReadPair, ReadSet} from '../src/isolates/catalog.js';
import {resolveIlluminaPreprocessing} from '../src/isolates/illumina/metadata.js';

export function testReadSet(pairs: ReadPair[], overrides: Partial<ReadSet> = {}): ReadSet {
  return {id: 'reads', name: 'Test library reads', platform: 'illumina', layout: 'paired-end',
    library_id: 'library-a', illumina: {chemistry: 'two-colour', poly_g: 'auto'}, read_pairs: pairs, ...overrides};
}

export function testSnapshotReadSet(pairs: ReadPair[]) {
  const set = testReadSet(pairs);
  return {...set, effective_preprocessing: resolveIlluminaPreprocessing(set)};
}
