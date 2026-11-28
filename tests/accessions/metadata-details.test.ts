import assert from 'node:assert/strict';
import test from 'node:test';
import {parse, stringify} from 'yaml';
import {emptyAccessionCatalog, validateAccessionCatalog} from '../../src/accessions/catalog.js';
import {parseAssemblyReport} from '../../src/accessions/provider/ncbi/metadata-fetch.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {veupathdbProvider} from '../../src/accessions/provider/veupathdb/index.js';
import {metadataSections} from '../../src/ui/accessions-screen/metadata-summary.js';
import {formatLocalDate, formatLocalDateTime} from '../../src/ui/utils.js';

const accession = 'GCA_000000001.1';
const retrievedAt = '2026-01-01T12:00:00.000Z';
const organism = {organism_name: 'Synthetic organism'};

function rows(metadata: ReturnType<typeof ncbiProvider.mapMetadata>) {
  return new Map(metadataSections(metadata).flatMap(section => section.rows).map(row => [row.id, row]));
}

test('REST and cached reports map assembly dates, statistics and linked records after YAML round-trip', () => {
  for (const [report, source] of [
    [{accession, organism, assembly_info: {release_date: '2025-04-03', bioproject_accession: 'PRJNA123', biosample: {accession: 'SAMN123'}},
      assembly_stats: {total_sequence_length: '1234567', gc_percent: 42.5, number_of_contigs: 5, number_of_scaffolds: 2, contig_n50: 400000, scaffold_n50: 800000}}, 'datasets-v2-rest'],
    [{accession, organism, assemblyInfo: {releaseDate: '2025-04-03', bioprojectAccession: 'PRJNA123', biosample: {accession: 'SAMN123'}},
      assemblyStats: {totalSequenceLength: '1234567', gcPercent: 42.5, numberOfContigs: 5, numberOfScaffolds: 2, contigN50: 400000, scaffoldN50: 800000}}, 'cached-download-report'],
  ] as const) {
    const metadata = parseAssemblyReport(report, accession, source, retrievedAt)!;
    const catalog = {...emptyAccessionCatalog(), accessions: [{source: 'ncbi', id: accession, parameters: {}, metadata, cached_copies: []}]};
    const restored = validateAccessionCatalog(parse(stringify(catalog)));
    assert.deepEqual(restored, catalog);
    const mapped = ncbiProvider.mapMetadata(restored.accessions[0]!.metadata);
    const sections = metadataSections(mapped);
    assert.deepEqual(sections.map(section => section.id), ['assembly', 'statistics', 'provider', 'provenance']);
    const values = rows(mapped);
    assert.equal(values.get('genome.release_date')?.value, formatLocalDate('2025-04-03'));
    assert.equal(values.get('metadata.retrieved_at')?.value, formatLocalDateTime(retrievedAt));
    assert.ok(values.get('metadata.source')?.value);
    assert.equal(values.get('genome.total_sequence_length')?.value, '1,234,567 bp');
    assert.equal(values.get('genome.gc_percent')?.value, '42.5%');
    assert.equal(values.get('genome.contig_n50')?.value, '400,000 bp');
    assert.equal(values.get('genome.scaffold_n50')?.value, '800,000 bp');
    assert.equal(values.get('genome.number_of_contigs')?.value, '5');
    assert.equal(values.get('genome.number_of_scaffolds')?.value, '2');
    assert.equal(values.get('provider.bioproject_accession')?.value, 'https://www.ncbi.nlm.nih.gov/bioproject/PRJNA123');
    assert.equal(values.get('provider.biosample_accession')?.value, 'https://www.ncbi.nlm.nih.gov/biosample/SAMN123');
  }
});

test('providers share field IDs and unavailable values without inventing equivalents', () => {
  const ncbi = ncbiProvider.mapMetadata(parseAssemblyReport({accession, organism}, accession, 'cached-download-report', retrievedAt)!);
  const veu = veupathdbProvider.mapMetadata({site: 'FungiDB', release: 71, organism_abbreviation: 'ExampleA',
    organism: 'Synthetic organism', tax_id: 123, strain: 'test', number_of_contigs: 0,
    assembly: '2020-01-01', megabps: 3.14, supercontig_count: 2, chromosome_count: 1});
  assert.deepEqual(metadataSections(ncbi).slice(0, 2).map(section => section.rows.map(row => row.id)),
    metadataSections(veu).slice(0, 2).map(section => section.rows.map(row => row.id)));
  assert.equal(rows(veu).get('genome.organism')?.value, 'Synthetic organism (taxon 123)');
  assert.equal(rows(veu).get('genome.strain')?.value, 'test');
  assert.equal(rows(veu).get('genome.number_of_contigs')?.value, '0');
  for (const id of ['assembly_name', 'release_date', 'total_sequence_length', 'number_of_scaffolds']) {
    assert.equal(rows(veu).get(`genome.${id}`)?.muted, true);
  }
  assert.equal(rows(veu).get('provider.megabps')?.value, '3.14');
  assert.equal(rows(veu).get('provider.assembly')?.value, '2020-01-01');
  assert.ok(metadataSections(ncbi).find(section => section.id === 'statistics')?.rows.every(row => row.muted));
  assert.equal(rows(ncbiProvider.mapMetadata({...parseAssemblyReport({accession, organism}, accession, 'cached-download-report', retrievedAt)!, gc_percent: 0})).get('genome.gc_percent')?.value, '0%');
});

test('null and historical provider facts leave all shared fields unavailable', () => {
  for (const mapped of [ncbiProvider.mapMetadata(null), veupathdbProvider.mapMetadata(null),
    veupathdbProvider.mapMetadata({site: 'FungiDB', release: 70, organism_abbreviation: 'ExampleA'})]) {
    assert.ok(metadataSections(mapped).slice(0, 2).every(section => section.rows.every(row => row.muted)));
    assert.equal(mapped.retrieved_at, undefined);
  }
});

test('invalid statistics are omitted from NCBI reports and rejected in persisted catalogs', () => {
  const metadata = parseAssemblyReport({accession, organism, assembly_stats: {
    total_sequence_length: '9007199254740993', gc_percent: 101, number_of_contigs: -1, contig_n50: 1.5,
  }}, accession, 'datasets-v2-rest', retrievedAt)!;
  for (const field of ['total_sequence_length', 'gc_percent', 'number_of_contigs', 'contig_n50']) {
    assert.ok(!(field in metadata));
    assert.throws(() => validateAccessionCatalog({...emptyAccessionCatalog(), accessions: [
      {source: 'ncbi', id: accession, parameters: {}, metadata: {...metadata, [field]: -1}, cached_copies: []},
    ]}));
  }
});
