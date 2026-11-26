import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {emptyAccessionCatalog, validateAccessionCatalog, withAccession} from '../../src/accessions/catalog.js';
import {applyCacheScan, deleteAccessionCaches, scanAccessionCaches} from '../../src/accessions/cache-discovery.js';
import {loadAccessionCatalog, updateAccessionCatalog} from '../../src/accessions/store.js';
import {genomeSources} from '../../src/genome-sources/registry.js';
import {ncbiProvider} from '../../src/genome-sources/ncbi.js';
import {GenomeProviderRegistry, missingProviderFields, referenceKey} from '../../src/genome-sources/provider.js';

const other = {...ncbiProvider, id: 'synthetic', cacheDirectory: 'synthetic-cache', validateReference(id: string, parameters: unknown) {
  return {...ncbiProvider.validateReference(id, parameters), source: 'synthetic'};
}};
genomeSources.register(other);
const reference = {source: 'ncbi', id: 'GCF_000149205.2', parameters: {}};
const second = {...reference, source: other.id};
const entry = (ref = reference) => ({...ref, metadata: null, cached_copies: []});

test('catalog identity, replacement, and discovery use the provider and ID pair', async context => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-providers-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const catalog = withAccession(withAccession(emptyAccessionCatalog(), entry()), entry(second));
  assert.equal(validateAccessionCatalog(catalog).accessions.length, 2);
  const updated = withAccession(catalog, {...entry(second), name: 'Only second'});
  assert.equal(updated.accessions[0]?.name, undefined);
  assert.equal(updated.accessions[1]?.name, 'Only second');
  assert.throws(() => validateAccessionCatalog({...catalog, accessions: [entry(), entry()]}));
  assert.throws(() => validateAccessionCatalog({...catalog, accessions: [{...entry(), parameters: {api_key: 'not-allowed'}}]}));

  for (const ref of [reference, second]) {
    const directory = join(root, genomeSources.get(ref.source).cacheDirectory, ref.id);
    await mkdir(directory, {recursive: true});
    const fasta = `>synthetic\n${ref.source === 'ncbi' ? 'ACGT' : 'AAAA'}\n`;
    await writeFile(join(directory, 'genomic.fna'), fasta);
    await writeFile(join(directory, 'checksums.json'), JSON.stringify({fasta: createHash('sha256').update(fasta).digest('hex')}));
    await writeFile(join(directory, 'genome.json'), JSON.stringify({reference: ref, metadata: null}));
  }
  const scan = await scanAccessionCaches([root]);
  assert.equal(scan.copies.length, 2);
  assert.equal(new Set(scan.copies.map(referenceKey)).size, 2);
  const discovered = applyCacheScan(updated, scan);
  assert.ok(discovered.accessions.every(value => value.cached_copies.length === 1));
  assert.notEqual(discovered.accessions[0]?.cached_copies[0]?.fasta_sha256, discovered.accessions[1]?.cached_copies[0]?.fasta_sha256);
  await deleteAccessionCaches([root], second);
  assert.equal((await scanAccessionCaches([root])).copies[0]?.source, 'ncbi');
});

test('registry detects optional methods and validates declared secret fields', () => {
  const {lookupMetadata: _metadata, ...exactOnly} = ncbiProvider;
  const registry = new GenomeProviderRegistry([exactOnly]);
  assert.equal(registry.get('ncbi').lookupMetadata, undefined);
  assert.equal(registry.get('ncbi').search, undefined);
  assert.equal(registry.get('ncbi').browse, undefined);
  assert.equal(missingProviderFields(exactOnly, {}).length, 0);
  const required = {...exactOnly, fields: [{id: 'token', label: 'Token', kind: 'secret' as const, required: true}]};
  assert.equal(missingProviderFields(required, {}).length, 1);
  assert.equal(missingProviderFields(required, {token: 'configured-not-service-verified'}).length, 0);
  assert.throws(() => registry.register(exactOnly), /Duplicate/);
  assert.throws(() => new GenomeProviderRegistry([{...required, fields: [...required.fields, ...required.fields]}]), /field/);
});

test('locked store rejects old schemas without replacing their contents', async context => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-old-catalog-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'catalog.yaml');
  const old = 'schema_version: 1\noutput_roots: []\naccessions: []\n';
  await writeFile(path, old);
  await assert.rejects(loadAccessionCatalog(path));
  await assert.rejects(updateAccessionCatalog(path, undefined, () => emptyAccessionCatalog()));
  assert.equal(await readFile(path, 'utf8'), old);
});
