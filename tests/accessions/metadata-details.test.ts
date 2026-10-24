import assert from 'node:assert/strict';
import test from 'node:test';
import {parse, stringify} from 'yaml';
import {emptyAccessionCatalog, validateAccessionCatalog} from '../../src/accessions/catalog.js';
import {parseAssemblyReport} from '../../src/accessions/ncbi-metadata.js';
import {metadataSections} from '../../src/ui/accessions-screen/metadata-summary.js';
import {formatLocalDateTime} from '../../src/ui/utils.js';

const accession = 'GCA_000000001.1';
const retrievedAt = '2026-01-01T12:00:00.000Z';
const organism = {organism_name: 'Synthetic organism'};

test('REST and cached reports preserve assembly dates, statistics and linked records through YAML', () => {
  for (const report of [
    {accession, organism, assembly_info: {release_date: '2025-04-03', bioproject_accession: 'PRJNA123', biosample: {accession: 'SAMN123'}},
      assembly_stats: {total_sequence_length: '1234567', gc_percent: 42.5, number_of_contigs: 5, number_of_scaffolds: 2, contig_n50: 400000, scaffold_n50: 800000}},
    {accession, organism, assemblyInfo: {releaseDate: '2025-04-03', bioprojectAccession: 'PRJNA123', biosample: {accession: 'SAMN123'}},
      assemblyStats: {totalSequenceLength: '1234567', gcPercent: 42.5, numberOfContigs: 5, numberOfScaffolds: 2, contigN50: 400000, scaffoldN50: 800000}},
  ]) {
    const metadata = parseAssemblyReport(report, accession, 'datasets-v2-rest', retrievedAt)!;
    assert.equal(metadata.release_date, '2025-04-03');
    assert.equal(metadata.total_sequence_length, 1234567);
    assert.equal(metadata.gc_percent, 42.5);
    const catalog = {...emptyAccessionCatalog(), accessions: [{accession, ncbi: metadata, cached_copies: []}]};
    assert.deepEqual(validateAccessionCatalog(parse(stringify(catalog))), catalog);
    const sections = metadataSections(metadata);
    assert.deepEqual(sections.map(section => section.id), ['assembly', 'statistics', 'records']);
    const assemblyRows = new Map(sections.find(section => section.id === 'assembly')!.rows.map(row => [row.id, row]));
    assert.equal(assemblyRows.get('ncbi.retrieved_at')?.value, formatLocalDateTime(retrievedAt));
    assert.ok(assemblyRows.get('ncbi.source')?.value);
    const rows = new Map(sections.flatMap(section => section.rows).map(row => [row.id, row]));
    assert.equal(rows.get('ncbi.total_sequence_length')?.value, '1,234,567 bp');
    assert.equal(rows.get('ncbi.gc_percent')?.value, '42.5%');
    assert.equal(rows.get('ncbi.contig_n50')?.value, '400,000 bp');
    assert.equal(rows.get('ncbi.scaffold_n50')?.value, '800,000 bp');
    assert.equal(rows.get('ncbi.number_of_contigs')?.value, '5');
    assert.equal(rows.get('ncbi.number_of_scaffolds')?.value, '2');
    assert.equal(rows.get('ncbi.bioproject_accession')?.value, 'https://www.ncbi.nlm.nih.gov/bioproject/PRJNA123');
    assert.equal(rows.get('ncbi.biosample_accession')?.value, 'https://www.ncbi.nlm.nih.gov/biosample/SAMN123');
  }
});

test('absent facts remain unavailable and zero is displayed rather than treated as missing', () => {
  const metadata = parseAssemblyReport({accession, organism}, accession, 'cached-download-report', retrievedAt)!;
  assert.equal(metadata.release_date, undefined);
  assert.equal(metadata.total_sequence_length, undefined);
  const sections = metadataSections(metadata);
  assert.ok(sections.find(section => section.id === 'statistics')?.rows.every(row => row.muted));
  assert.ok(sections.find(section => section.id === 'records')?.rows.every(row => row.muted));
  assert.equal(metadataSections({...metadata, gc_percent: 0}).flatMap(section => section.rows).find(row => row.id === 'ncbi.gc_percent')?.value, '0%');
});

test('invalid statistics are omitted from reports and rejected in persisted catalogs', () => {
  const metadata = parseAssemblyReport({accession, organism, assembly_stats: {
    total_sequence_length: '9007199254740993', gc_percent: 101, number_of_contigs: -1, contig_n50: 1.5,
  }}, accession, 'datasets-v2-rest', retrievedAt)!;
  for (const field of ['total_sequence_length', 'gc_percent', 'number_of_contigs', 'contig_n50']) {
    assert.ok(!(field in metadata));
    assert.throws(() => validateAccessionCatalog({...emptyAccessionCatalog(), accessions: [
      {accession, ncbi: {...metadata, [field]: -1}, cached_copies: []},
    ]}));
  }
});
