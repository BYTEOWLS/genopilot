import {ncbiMetadata} from '../../src/accessions/provider/ncbi/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccessionCatalogValidationError,
  emptyAccessionCatalog,
  parseAccessionCatalog,
  recordedCacheState,
  validateAccessionCatalog,
  withAccession,
  type AccessionCatalog,
  type AccessionEntry,
} from '../../src/accessions/catalog.js';

const fastaA = 'a'.repeat(64);
const fastaB = 'b'.repeat(64);

function entry(accession: string, overrides: Partial<AccessionEntry> = {}): AccessionEntry {
  return {source: 'ncbi', id: accession, parameters: {}, metadata: null, cached_copies: [], ...overrides};
}

function catalogWith(...accessions: AccessionEntry[]): AccessionCatalog {
  return {...emptyAccessionCatalog(), accessions};
}

function issuesFor(value: unknown): {path: string; message: string}[] {
  try {
    validateAccessionCatalog(value);
  } catch (error) {
    assert.ok(error instanceof AccessionCatalogValidationError);
    return [...error.issues];
  }
  assert.fail('Expected the catalog to be rejected.');
}

test('accepts metadata without a strain and an uncached entry', () => {
  const catalog = parseAccessionCatalog(`
schema_version: 2
output_roots: [/analysis/genopilot]
accessions:
  - source: ncbi
    id: GCF_000149205.2
    parameters: {}
    name: Backbone
    description: Local note
    metadata:
      organism: Example organism
      tax_id: 42
      assembly_name: Example assembly
      assembly_type: haploid
      refseq_category: reference genome
      submitter: Example submitter
      retrieved_at: 2026-01-01T12:00:00.000Z
      source: datasets-v2-rest
    cached_copies: []
`);

  assert.equal(ncbiMetadata(catalog.accessions[0]?.metadata)?.strain, undefined);
  assert.equal(recordedCacheState(catalog.accessions[0]!), 'not-cached');
});

test('rejects unversioned accessions, unknown fields, and malformed copies', () => {
  const issues = issuesFor({
    ...emptyAccessionCatalog(),
    output_roots: ['relative/root'],
    accessions: [
      {source: 'ncbi', id: 'GCF_000149205', parameters: {}, metadata: null, cached_copies: [], extra: true},
      entry('GCF_000149205.2', {
        metadata: {organism: ' padded ', retrieved_at: 'yesterday', source: 'guess'} as never,
        cached_copies: [{path: '/cache/GCF_000000001.1', verified_at: '2026-01-01T12:00:00Z', fasta_sha256: 'x'}],
      }),
    ],
  });
  const paths = issues.map(issue => issue.path);

  assert.ok(paths.includes('$.output_roots[0]'));
  assert.ok(paths.includes('$.accessions[0]'));
  assert.ok(paths.includes('$.accessions[0].extra'));
  assert.ok(paths.includes('$.accessions[1].metadata'));
  const metadataProblem = issues.find(issue => issue.path === '$.accessions[1].metadata')!.message;
  assert.match(metadataProblem, /organism/);
  assert.match(metadataProblem, /retrieved_at/);
  assert.match(metadataProblem, /source/);
  assert.ok(paths.includes('$.accessions[1].cached_copies[0].path'));
  assert.ok(paths.includes('$.accessions[1].cached_copies[0].fasta_sha256'));
});

test('rejects repeated accessions, roots, and copy paths', () => {
  const copy = {path: '/cache/GCF_000149205.2', verified_at: '2026-01-01T12:00:00.000Z', fasta_sha256: fastaA};
  const issues = issuesFor({
    ...emptyAccessionCatalog(),
    output_roots: ['/analysis', '/analysis/'],
    accessions: [
      entry('GCF_000149205.2', {cached_copies: [copy, copy]}),
      entry('GCF_000149205.2'),
    ],
  });

  assert.deepEqual(issues.map(issue => issue.path).sort(), [
    '$.accessions[0].cached_copies[1].path',
    '$.accessions[1].id',
    '$.output_roots[1]',
  ]);
});

test('reports a conflict when verified copies hold different bytes', () => {
  const copy = (path: string, fasta: string, gff3?: string) => ({
    path: `${path}/GCF_000149205.2`,
    verified_at: '2026-01-01T12:00:00.000Z',
    fasta_sha256: fasta,
    ...(gff3 ? {gff3_sha256: gff3} : {}),
  });

  assert.equal(recordedCacheState(entry('GCF_000149205.2', {cached_copies: [copy('/a', fastaA)]})), 'cached');
  assert.equal(
    recordedCacheState(entry('GCF_000149205.2', {cached_copies: [copy('/a', fastaA), copy('/b', fastaA, fastaB)]})),
    'cached',
  );
  assert.equal(
    recordedCacheState(entry('GCF_000149205.2', {cached_copies: [copy('/a', fastaA), copy('/b', fastaB)]})),
    'conflict',
  );
  assert.equal(
    recordedCacheState(entry('GCF_000149205.2', {
      cached_copies: [copy('/a', fastaA, fastaA), copy('/b', fastaA, fastaB)],
    })),
    'conflict',
  );
});

test('replaces an entry by accession or appends a new one', () => {
  const catalog = catalogWith(entry('GCF_000149205.2', {name: 'Old'}));

  assert.equal(withAccession(catalog, entry('GCF_000149205.2', {name: 'New'})).accessions[0]?.name, 'New');
  assert.equal(withAccession(catalog, entry('GCA_000000001.1')).accessions.length, 2);
});
