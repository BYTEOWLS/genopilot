import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {
  applyCacheScan,
  deleteAccessionCaches,
  scanAccessionCaches,
  type CacheScan,
} from '../../src/accessions/cache-discovery.js';
import {emptyAccessionCatalog, type AccessionCatalog} from '../../src/accessions/catalog.js';

const accession = 'GCF_000149205.2';
const now = () => new Date('2026-01-01T12:00:00.000Z');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function temporaryDirectory(context: TestContext): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'genopilot-accession-cache-')));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

/** Writes a cache directory the way `workflows/shared/scripts/resolve_input.py` leaves it. */
async function writeCopy(
  root: string,
  {
    name = accession,
    fasta = '>chr1\nACGT\n',
    gff3,
    checksums,
    report,
  }: {
    name?: string;
    fasta?: string | null;
    gff3?: string;
    checksums?: unknown;
    report?: unknown;
  } = {},
): Promise<string> {
  const directory = join(root, 'ncbi-accessions-cache', name);
  await mkdir(directory, {recursive: true});
  if (fasta !== null) {
    await writeFile(join(directory, 'genomic.fna'), fasta);
  }
  if (gff3 !== undefined) {
    await writeFile(join(directory, 'genomic.gff'), gff3);
  }
  const recorded = checksums ?? {
    fasta: sha256(fasta ?? ''),
    ...(gff3 !== undefined ? {gff3: sha256(gff3)} : {}),
  };
  await writeFile(join(directory, 'checksums.json'), typeof recorded === 'string' ? recorded : JSON.stringify(recorded));
  if (report !== undefined) {
    await mkdir(join(directory, 'ncbi_dataset', 'data'), {recursive: true});
    await writeFile(join(directory, 'ncbi_dataset', 'data', 'assembly_data_report.jsonl'), `${JSON.stringify(report)}\n`);
  }
  return directory;
}

test('verifies copies and explains damaged ones without trusting them', async context => {
  const root = await temporaryDirectory(context);
  const verified = await writeCopy(root, {gff3: '##gff-version 3\n'});
  await writeCopy(root, {name: 'GCF_000000001.1', fasta: '>changed\n', checksums: {fasta: sha256('>original\n')}});
  await writeCopy(root, {name: 'GCF_000000002.1', fasta: null});
  await writeCopy(root, {name: 'GCF_000000003.1', checksums: 'not json'});
  await writeCopy(root, {name: 'GCF_000000004.1', checksums: {fasta: sha256('>chr1\nACGT\n'), gff3: sha256('x')}});
  await mkdir(join(root, 'ncbi-accessions-cache', 'not-an-accession'));

  const scan = await scanAccessionCaches([root], now);
  const byAccession = new Map(scan.copies.map(copy => [copy.accession, copy]));

  assert.equal(byAccession.get(accession)?.state, 'verified');
  assert.equal(byAccession.get(accession)?.path, verified);
  assert.equal(byAccession.get(accession)?.gff3_sha256, sha256('##gff-version 3\n'));
  assert.equal(byAccession.get('GCF_000000001.1')?.state, 'checksum-invalid');
  assert.equal(byAccession.get('GCF_000000002.1')?.state, 'incomplete');
  assert.equal(byAccession.get('GCF_000000003.1')?.state, 'incomplete');
  assert.equal(byAccession.get('GCF_000000004.1')?.state, 'incomplete');
  assert.ok(scan.copies.filter(copy => copy.state !== 'verified').every(copy => copy.problem));
  assert.deepEqual(scan.ignored.map(entry => entry.path), [join(root, 'ncbi-accessions-cache', 'not-an-accession')]);
  assert.ok(scan.ignored.every(entry => entry.reason.length > 0));
});

test('accepts a FASTA-only copy and reads its cached NCBI report', async context => {
  const root = await temporaryDirectory(context);
  await writeCopy(root, {
    report: {accession, organism: {organismName: 'Example organism'}, assemblyInfo: {assemblyName: 'Example'}},
  });

  const [copy] = (await scanAccessionCaches([root], now)).copies;

  assert.equal(copy?.state, 'verified');
  assert.equal(copy?.gff3_sha256, undefined);
  assert.equal(copy?.report?.organism, 'Example organism');
  assert.equal(copy?.report?.source, 'cached-download-report');
});

test('reads a cached report that spans several lines', async context => {
  const root = await temporaryDirectory(context);
  const directory = await writeCopy(root);
  await mkdir(join(directory, 'ncbi_dataset', 'data'), {recursive: true});
  const report = {accession, organism: {organismName: 'Example organism'}, assemblyInfo: {assemblyType: 'haploid'}};
  await writeFile(join(directory, 'ncbi_dataset', 'data', 'assembly_data_report.jsonl'), JSON.stringify(report, null, 2));

  const [copy] = (await scanAccessionCaches([root], now)).copies;

  assert.equal(copy?.report?.organism, 'Example organism');
  assert.equal(copy?.report?.assembly_type, 'haploid');
});

test('skips missing roots and lists one directory reached through two roots once', async context => {
  const root = await temporaryDirectory(context);
  await writeCopy(root);
  const alias = join(await temporaryDirectory(context), 'alias');
  await symlink(root, alias);

  const scan = await scanAccessionCaches([root, alias, join(root, 'missing')], now);

  assert.equal(scan.copies.length, 1);
  assert.deepEqual(scan.rootProblems, []);
});

test('records verified copies in the catalog, keeps REST metadata, and flags conflicts', async context => {
  const first = await temporaryDirectory(context);
  const second = await temporaryDirectory(context);
  await writeCopy(first, {report: {accession, organism: {organismName: 'From report'}}});
  await writeCopy(second, {fasta: '>chr1\nTTTT\n'});
  await writeCopy(first, {name: 'GCA_000000009.1', report: {accession: 'GCA_000000009.1', organism: {organismName: 'Found'}}});
  const catalog: AccessionCatalog = {
    ...emptyAccessionCatalog(),
    accessions: [{
      accession,
      name: 'Backbone',
      ncbi: {organism: 'From REST', retrieved_at: '2025-01-01T00:00:00.000Z', source: 'datasets-v2-rest'},
      cached_copies: [],
    }],
  };

  const scan = await scanAccessionCaches([first, second], now);
  const next = applyCacheScan(catalog, scan);
  const backbone = next.accessions.find(entry => entry.accession === accession);
  const found = next.accessions.find(entry => entry.accession === 'GCA_000000009.1');

  assert.equal(backbone?.name, 'Backbone');
  assert.equal(backbone?.ncbi?.organism, 'From REST');
  assert.equal(backbone?.cached_copies.length, 2);
  assert.notEqual(backbone?.cached_copies[0]?.fasta_sha256, backbone?.cached_copies[1]?.fasta_sha256);
  assert.equal(found?.ncbi?.source, 'cached-download-report');
  assert.equal(found?.cached_copies[0]?.verified_at, '2026-01-01T12:00:00.000Z');
});

test('keeps the first verification time of unchanged copies and drops damaged ones', async context => {
  const root = await temporaryDirectory(context);
  const directory = await writeCopy(root);
  const firstScan = await scanAccessionCaches([root], now);
  const recorded = applyCacheScan(emptyAccessionCatalog(), firstScan);

  const laterScan = await scanAccessionCaches([root], () => new Date('2026-02-01T00:00:00.000Z'));
  assert.deepEqual(applyCacheScan(recorded, laterScan), recorded);

  await writeFile(join(directory, 'genomic.fna'), '>tampered\n');
  const damagedScan: CacheScan = await scanAccessionCaches([root], now);
  const updated = applyCacheScan(recorded, damagedScan);
  assert.deepEqual(updated.accessions[0]?.cached_copies, []);
});

test('deletes every cache directory of an accession, damaged or not', async context => {
  const first = await temporaryDirectory(context);
  const second = await temporaryDirectory(context);
  const verified = await writeCopy(first);
  const damaged = await writeCopy(second, {fasta: null});
  const other = await writeCopy(first, {name: 'GCF_000000001.1'});

  const deleted = await deleteAccessionCaches([first, second, first], accession);

  assert.deepEqual(deleted.sort(), [verified, damaged].sort());
  await assert.rejects(stat(verified), {code: 'ENOENT'});
  await assert.rejects(stat(damaged), {code: 'ENOENT'});
  assert.ok((await stat(other)).isDirectory());
});

test('refuses to delete through a symbolic link or for an invalid accession', async context => {
  const root = await temporaryDirectory(context);
  const elsewhere = await temporaryDirectory(context);
  await writeFile(join(elsewhere, 'keep.txt'), 'keep');
  await mkdir(join(root, 'ncbi-accessions-cache'), {recursive: true});
  await symlink(elsewhere, join(root, 'ncbi-accessions-cache', accession));

  await assert.rejects(deleteAccessionCaches([root], accession), /not a directory/);
  await assert.rejects(deleteAccessionCaches([root], '../escape'), /invalid accession/);
  assert.deepEqual(await readdir(elsewhere), ['keep.txt']);
});

test('lists a symbolically linked accession directory as skipped instead of following it', async context => {
  const root = await temporaryDirectory(context);
  const elsewhere = await writeCopy(await temporaryDirectory(context));
  await mkdir(join(root, 'ncbi-accessions-cache'), {recursive: true});
  const link = join(root, 'ncbi-accessions-cache', 'GCF_000000005.1');
  await symlink(elsewhere, link);

  const scan = await scanAccessionCaches([root], now);

  assert.deepEqual(scan.copies, []);
  assert.deepEqual(scan.ignored.map(entry => entry.path), [link]);
});

test('a partial scan replaces only the copies inside the cache directories it read', async context => {
  const scanned = await temporaryDirectory(context);
  const unscanned = await temporaryDirectory(context);
  const kept = await writeCopy(unscanned);
  const recorded = applyCacheScan(emptyAccessionCatalog(), await scanAccessionCaches([unscanned], now));
  await writeCopy(scanned);

  const partial = applyCacheScan(recorded, await scanAccessionCaches([scanned], now), {partial: true});
  const full = applyCacheScan(recorded, await scanAccessionCaches([scanned], now));

  assert.deepEqual(partial.accessions[0]?.cached_copies.map(copy => copy.path).sort(), [kept, join(scanned, 'ncbi-accessions-cache', accession)].sort());
  assert.deepEqual(full.accessions[0]?.cached_copies.map(copy => copy.path), [join(scanned, 'ncbi-accessions-cache', accession)]);
});
