import assert from 'node:assert/strict';
import test from 'node:test';
import {snapshotGenomeCopy, validateRemoteGenomeInput, type RemoteGenomeInput} from '../../src/workflows/genome-input.js';
import type {AccessionEntry} from '../../src/accessions/catalog.js';
import type {ConfigurationValidationIssue} from '../../src/workflows/configuration-validation.js';

const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
const input = (): RemoteGenomeInput => ({source: 'remote', reference: structuredClone(reference), cache_mode: 'reuse'});
const entry = (): AccessionEntry => ({...reference, metadata: null, cached_copies: [
  {path: '/annotation-only/GCF_000000001.1', verified_at: '2026-01-01T00:00:00Z', gff3_sha256: 'b'.repeat(64)},
  {path: '/sequence-only/GCF_000000001.1', verified_at: '2026-01-01T00:00:00Z', fasta_sha256: 'a'.repeat(64)},
  {path: '/both/GCF_000000001.1', verified_at: '2026-01-01T00:00:00Z', fasta_sha256: 'a'.repeat(64), gff3_sha256: 'b'.repeat(64)},
]});

test('snapshots only copies with all role-required artifacts and only their checksums', () => {
  const target = input();
  snapshotGenomeCopy(target, ['fasta'], [entry()]);
  assert.deepEqual(target.copy, {path: '/sequence-only/GCF_000000001.1', fasta_sha256: 'a'.repeat(64)});
  const referenceInput = input();
  snapshotGenomeCopy(referenceInput, ['fasta', 'gff3'], [entry()]);
  assert.deepEqual(referenceInput.copy, {path: '/both/GCF_000000001.1', fasta_sha256: 'a'.repeat(64), gff3_sha256: 'b'.repeat(64)});
});

test('uncached or incomplete entries remain remote download references without a copy', () => {
  for (const copies of [[], [entry().cached_copies[0]!], [entry().cached_copies[1]!]]) {
    const source = input();
    snapshotGenomeCopy(source, ['fasta', 'gff3'], [{...entry(), cached_copies: copies}]);
    assert.equal(source.copy, undefined);
    assert.deepEqual(source.reference, reference);
  }
});

test('snapshots match source, ID and parameters, and never replace a saved snapshot', () => {
  const source = input();
  snapshotGenomeCopy(source, ['fasta'], [{...entry(), source: 'other'}, {...entry(), parameters: {release: 71}}]);
  assert.equal(source.copy, undefined);
  snapshotGenomeCopy(source, ['fasta'], [entry()]);
  const saved = structuredClone(source.copy);
  snapshotGenomeCopy(source, ['fasta'], [{...entry(), cached_copies: []}]);
  assert.deepEqual(source.copy, saved);
  source.cache_mode = 'refresh';
  snapshotGenomeCopy(source, ['fasta'], [entry()]);
  assert.equal(source.copy, undefined);
});

test('validates pinned references and role-specific snapshots, rejecting legacy fields and secrets', () => {
  const valid = input();
  snapshotGenomeCopy(valid, ['fasta', 'gff3'], [entry()]);
  const issues: ConfigurationValidationIssue[] = [];
  assert.deepEqual(validateRemoteGenomeInput(valid, '$.input', ['fasta', 'gff3'], issues), valid);
  assert.deepEqual(issues, []);
  for (const value of [
    {...valid, cache_mode: 'refresh'},
    {...valid, cache_mode: undefined},
    {...valid, accession: reference.id},
    {...valid, reference: {...reference, parameters: {api_key: 'not-a-secret'}}},
    {...valid, reference: {...reference, secret: 'not-a-secret'}},
    {...valid, copy: {path: '/relative', fasta_sha256: 'wrong'}},
    {...valid, copy: {path: '/both/GCF_000000001.1', fasta_sha256: 'a'.repeat(64)}},
  ]) {
    const problems: ConfigurationValidationIssue[] = [];
    assert.equal(validateRemoteGenomeInput(value, '$.input', ['fasta', 'gff3'], problems), undefined);
    assert.ok(problems.length > 0);
  }
});
