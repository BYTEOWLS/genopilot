import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {deflateRawSync} from 'node:zlib';
import {resolveGenomeCache} from '../../src/genome-sources/cache.js';
import {ncbiProvider} from '../../src/genome-sources/ncbi.js';
import {GenomeProviderRegistry} from '../../src/genome-sources/provider.js';
import {scanAccessionCaches} from '../../src/accessions/cache-discovery.js';

const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
const fasta = '>synthetic\nACGTNN\n';
const gff3 = '##gff-version 3\nsynthetic\ttest\tgene\t1\t4\t.\t+\t.\tID=g1\n';
const report = JSON.stringify({accession: reference.id, organism: {organism_name: 'Synthetic organism'}}) + '\n';
const prefix = `ncbi_dataset/data/${reference.id}/`;

/** Entirely synthetic ZIP with stored or deflated members, no downloaded genome fixtures. */
function zip(files: [string, string][], method = 8): Buffer {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const compressed = method === 8 ? deflateRawSync(data) : data;
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const label = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(label.length, 26);
    chunks.push(header, label, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, label);
    offset += header.length + label.length + compressed.length;
  }
  const entries = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(entries.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, entries, end]);
}

function members(annotation = true): [string, string][] {
  return [[`${prefix}${reference.id}_synthetic_genomic.fna`, fasta],
    ...(annotation ? [[`${prefix}genomic.gff`, gff3] as [string, string]] : []),
    ['ncbi_dataset/data/assembly_data_report.jsonl', report],
    ['ncbi_dataset/data/GCF_999999999.1/unrelated_genomic.fna', '>wrong\nTTTT\n'],
    ['../../never-extract', 'not a genome']];
}

async function root(context: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'genopilot-download-'));
  context.after(() => rm(path, {recursive: true, force: true}));
  return path;
}

function response(body: Buffer): typeof fetch {
  return async () => new Response(new Uint8Array(body), {headers: {'content-type': 'application/zip'}});
}

const signal = () => new AbortController().signal;

test('REST package selects only the pinned accession, verifies CRC and publishes checksums', async context => {
  const directory = await root(context);
  let requests = 0;
  const key = 'synthetic-secret-never-in-URL';
  const downloaded = await resolveGenomeCache({reference, kinds: ['fasta', 'gff3'], root: directory, mode: 'reuse'}, {
    signal: signal(), secrets: {'api-key': key},
    fetchImpl: async (input, init) => {
      requests += 1;
      const url = new URL(String(input));
      assert.equal(url.pathname, `/datasets/v2/genome/accession/${reference.id}/download`);
      assert.deepEqual(url.searchParams.getAll('include_annotation_type'), ['GENOME_FASTA', 'GENOME_GFF']);
      assert.ok(!String(input).includes(key));
      assert.equal(new Headers(init?.headers).get('api-key'), key);
      return response(zip(members()))(input, init);
    },
  });
  assert.equal(downloaded.downloaded, true);
  assert.equal(await readFile(downloaded.fasta, 'utf8'), fasta);
  assert.equal(await readFile(downloaded.gff3!, 'utf8'), gff3);
  assert.equal(downloaded.annotation, 'available');
  assert.equal((await scanAccessionCaches([directory])).copies[0]?.state, 'verified');
  const reused = await resolveGenomeCache({reference, kinds: ['fasta', 'gff3'], root: directory, mode: 'reuse'}, {
    signal: signal(), secrets: {}, fetchImpl: async () => {throw new Error('Network must not be used');},
  });
  assert.equal(requests, 1);
  assert.equal(reused.downloaded, false);
  assert.equal(reused.fasta_sha256, downloaded.fasta_sha256);
  assert.ok(!JSON.stringify(downloaded).includes(key));
});

test('only a successful package without GFF3 establishes annotation unavailability', async context => {
  const directory = await root(context);
  const request = {reference, kinds: ['fasta', 'gff3'] as const, root: directory, mode: 'reuse' as const};
  const result = await resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false), 0))});
  assert.equal(result.gff3, undefined);
  assert.equal(result.annotation, 'unavailable');
  await assert.rejects(resolveGenomeCache({...request, mode: 'refresh'}, {
    signal: signal(), secrets: {}, fetchImpl: async () => new Response('do not echo remote errors', {status: 503}),
  }), /HTTP 503/);
  assert.equal((await scanAccessionCaches([directory])).copies[0]?.state, 'verified');
});

test('missing, ambiguous and damaged archives are never published; failed refresh keeps the old copy', async context => {
  const directory = await root(context);
  const request = {reference, kinds: ['fasta'] as const, root: directory, mode: 'refresh' as const};
  const old = await resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false)))});
  const cases = [
    zip(members(false).filter(([name]) => !name.startsWith(prefix))),
    zip([...members(false), [`${prefix}other_genomic.fna`, fasta]]),
    zip(members(false).map(([name, content]) => [name, name.endsWith('.jsonl') ? report + report : content])),
    Buffer.from('not a zip'),
  ];
  const corrupted = zip(members(false), 0);
  const position = corrupted.indexOf(Buffer.from(fasta));
  corrupted[position + 12] = corrupted[position + 12]! ^ 1;
  cases.push(corrupted);
  for (const body of cases) {
    await assert.rejects(resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(body)}));
    assert.equal(await readFile(old.fasta, 'utf8'), fasta);
    assert.deepEqual(await readdir(join(directory, 'ncbi-accessions-cache')), [reference.id]);
  }
});

test('cancellation and concurrent writers leave no partial verified copy', async context => {
  const directory = await root(context);
  const controller = new AbortController();
  const request = {reference, kinds: ['fasta'] as const, root: directory, mode: 'refresh' as const};
  const old = await resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false)))});
  let started!: () => void;
  const entered = new Promise<void>(resolve => {started = resolve;});
  let finish!: () => void;
  const gate = new Promise<void>(resolve => {finish = resolve;});
  const running = resolveGenomeCache(request, {signal: controller.signal, secrets: {}, fetchImpl: async () => {
    started();
    await gate;
    return new Response(new Uint8Array(zip(members(false))));
  }});
  await entered;
  await assert.rejects(resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false)))}), /writer/);
  controller.abort();
  finish();
  await assert.rejects(running);
  assert.equal(await readFile(old.fasta, 'utf8'), fasta);
  assert.deepEqual(await readdir(join(directory, 'ncbi-accessions-cache')), [reference.id]);
});

test('snapshotted cross-root reuse requires its recorded digests and needs no credentials', async context => {
  const directory = await root(context);
  const other = await root(context);
  const result = await resolveGenomeCache({reference, kinds: ['fasta'], root: directory, mode: 'reuse'}, {
    signal: signal(), secrets: {}, fetchImpl: response(zip(members(false))),
  });
  const request = {reference, kinds: ['fasta'] as const, root: other, mode: 'reuse' as const,
    copy: {path: join(directory, 'ncbi-accessions-cache', reference.id), fasta_sha256: result.fasta_sha256}};
  assert.equal((await resolveGenomeCache(request, {signal: signal(), secrets: {}})).downloaded, false);
  await writeFile(result.fasta, '>changed\nAAAA\n');
  await assert.rejects(resolveGenomeCache(request, {signal: signal(), secrets: {}}), /checksums/);
});

test('required provider credentials block remote access but not verified reuse', async context => {
  const directory = await root(context);
  const registry = new GenomeProviderRegistry([{...ncbiProvider, fields: [{id: 'api-key', label: 'Secret', kind: 'secret', required: true}]}]);
  const request = {reference, kinds: ['fasta'] as const, root: directory, mode: 'reuse' as const};
  await assert.rejects(resolveGenomeCache(request, {signal: signal(), secrets: {}}, registry), /Configure/);
  await resolveGenomeCache(request, {signal: signal(), secrets: {'api-key': 'synthetic'}, fetchImpl: response(zip(members(false)))}, registry);
  assert.equal((await resolveGenomeCache(request, {signal: signal(), secrets: {}}, registry)).downloaded, false);
});
