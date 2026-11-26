import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {deflateRawSync} from 'node:zlib';
import {resolveGenomeCache} from '../../src/accessions/cache.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {GenomeProviderRegistry, type GenomeDownloadProgress} from '../../src/accessions/provider.js';
import {applyCacheScan, scanAccessionCaches} from '../../src/accessions/cache-discovery.js';
import {emptyAccessionCatalog, validateAccessionCatalog} from '../../src/accessions/catalog.js';

const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
const fasta = '>synthetic\nACGTNN\n';
const gff3 = '##gff-version 3\nsynthetic\ttest\tgene\t1\t4\t.\t+\t.\tID=g1\n';
const report = JSON.stringify({accession: reference.id, organism: {organism_name: 'Synthetic organism'}}) + '\n';
const prefix = `ncbi_dataset/data/${reference.id}/`;

/** Entirely synthetic ZIP with stored or deflated members, no downloaded genome fixtures. */
function zip(files: [string, string][], method = 8, options: {zip64?: boolean; zip64Directory?: boolean; descriptors?: boolean} = {}): Buffer {
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
    const localExtra = options.zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (options.zip64) {
      localExtra.writeUInt16LE(1);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(options.descriptors ? 0 : data.length), 4);
      localExtra.writeBigUInt64LE(BigInt(options.descriptors ? 0 : compressed.length), 12);
    }
    const descriptor = options.descriptors ? Buffer.alloc(24) : Buffer.alloc(0);
    if (options.descriptors) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeBigUInt64LE(BigInt(compressed.length), 8);
      descriptor.writeBigUInt64LE(BigInt(data.length), 16);
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(options.zip64 ? 45 : 20, 4);
    header.writeUInt16LE(options.descriptors ? 8 : 0, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(options.descriptors ? 0 : crc, 14);
    header.writeUInt32LE(options.zip64 ? 0xffffffff : compressed.length, 18);
    header.writeUInt32LE(options.zip64 ? 0xffffffff : data.length, 22);
    header.writeUInt16LE(label.length, 26);
    header.writeUInt16LE(localExtra.length, 28);
    chunks.push(header, label, localExtra, compressed, descriptor);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    const extra = options.zip64 ? Buffer.alloc(options.zip64Directory ? 28 : 20) : Buffer.alloc(0);
    if (options.zip64) {
      extra.writeUInt16LE(1);
      extra.writeUInt16LE(extra.length - 4, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(compressed.length), 12);
      if (options.zip64Directory) {
        extra.writeBigUInt64LE(BigInt(offset), 20);
      }
    }
    central.writeUInt16LE(options.zip64 ? 45 : 20, 6);
    central.writeUInt16LE(options.descriptors ? 8 : 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : compressed.length, 20);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : data.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(options.zip64Directory ? 0xffffffff : offset, 42);
    directory.push(central, label, extra);
    offset += header.length + label.length + localExtra.length + compressed.length + descriptor.length;
  }
  const entries = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(options.zip64Directory ? 65535 : files.length, 8);
  end.writeUInt16LE(options.zip64Directory ? 65535 : files.length, 10);
  end.writeUInt32LE(options.zip64Directory ? 0xffffffff : entries.length, 12);
  end.writeUInt32LE(options.zip64Directory ? 0xffffffff : offset, 16);
  const zip64End = options.zip64Directory ? Buffer.alloc(56) : Buffer.alloc(0);
  const locator = options.zip64Directory ? Buffer.alloc(20) : Buffer.alloc(0);
  if (options.zip64Directory) {
    zip64End.writeUInt32LE(0x06064b50);
    zip64End.writeBigUInt64LE(44n, 4);
    zip64End.writeBigUInt64LE(BigInt(files.length), 24);
    zip64End.writeBigUInt64LE(BigInt(files.length), 32);
    zip64End.writeBigUInt64LE(BigInt(entries.length), 40);
    zip64End.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50);
    locator.writeBigUInt64LE(BigInt(offset + entries.length), 8);
    locator.writeUInt32LE(1, 16);
  }
  return Buffer.concat([...chunks, entries, zip64End, locator, end]);
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
  assert.equal(await readFile(downloaded.fasta!, 'utf8'), fasta);
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

for (const zip64Directory of [false, true]) {
  test(`NCBI-style streamed ZIP64 members work with a ${zip64Directory ? 'ZIP64' : 'classic'} directory`, async context => {
    const directory = await root(context);
    const result = await resolveGenomeCache({reference, kinds: ['fasta', 'gff3'], root: directory, mode: 'refresh'}, {
      signal: signal(), secrets: {}, fetchImpl: response(zip(members(), 8, {zip64: true, zip64Directory, descriptors: true})),
    });
    assert.equal(await readFile(result.fasta!, 'utf8'), fasta);
    assert.equal(await readFile(result.gff3!, 'utf8'), gff3);
    assert.equal((await scanAccessionCaches([directory])).copies[0]?.state, 'verified');
  });
}

test('malformed, unsafe and multipart ZIP64 records cannot replace a verified genome', async context => {
  const directory = await root(context);
  const request = {reference, kinds: ['fasta'] as const, root: directory, mode: 'refresh' as const};
  const old = await resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false)))});
  for (const damage of ['missing-extra', 'short-extra', 'unsafe-size', 'bad-offset', 'bad-method', 'bad-crc', 'multipart', 'bad-locator', 'unsafe-directory', 'truncated-end']) {
    const archive = zip(members(false), 8, {zip64: true, zip64Directory: true, descriptors: true});
    const locator = archive.length - 42;
    const end64 = Number(archive.readBigUInt64LE(locator + 8));
    const central = Number(archive.readBigUInt64LE(end64 + 48));
    const extra = central + 46 + archive.readUInt16LE(central + 28);
    if (damage === 'missing-extra') { archive.writeUInt16LE(2, extra); }
    else if (damage === 'short-extra') { archive.writeUInt16LE(3, extra + 2); }
    else if (damage === 'unsafe-size') { archive.writeBigUInt64LE(2n ** 63n, extra + 4); }
    else if (damage === 'bad-offset') { archive.writeBigUInt64LE(BigInt(archive.length), extra + 20); }
    else if (damage === 'bad-method') { archive.writeUInt16LE(99, central + 10); }
    else if (damage === 'bad-crc') { archive.writeUInt32LE(0, central + 16); }
    else if (damage === 'multipart') { archive.writeUInt32LE(1, end64 + 20); }
    else if (damage === 'bad-locator') { archive.writeUInt32LE(0, locator); }
    else if (damage === 'unsafe-directory') { archive.writeBigUInt64LE(2n ** 63n, end64 + 40); }
    else { archive.writeBigUInt64LE(BigInt(archive.length), locator + 8); }
    await assert.rejects(resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(archive)}), () => true, damage);
    assert.equal(await readFile(old.fasta!, 'utf8'), fasta);
    assert.deepEqual(await readdir(join(directory, 'ncbi-accessions-cache')), [reference.id]);
  }
});

for (const knownTotal of [false, true]) {
  test(`download progress reports real bytes with ${knownTotal ? 'known' : 'unknown'} transfer size, then verification`, async context => {
    const directory = await root(context);
    const archive = zip(members(), 8, {zip64: true, descriptors: true});
    const events: GenomeDownloadProgress[] = [];
    await resolveGenomeCache({reference, kinds: ['fasta', 'gff3'], root: directory, mode: 'refresh'}, {
      signal: signal(), secrets: {}, onProgress: event => events.push(event),
      fetchImpl: async () => new Response(new ReadableStream({start(stream) {
        for (let offset = 0; offset < archive.length; offset += 128) {
          stream.enqueue(new Uint8Array(archive.subarray(offset, offset + 128)));
        }
        stream.close();
      }}), {headers: knownTotal ? {'content-length': String(archive.length)} : {}}),
    });
    const received = events.filter(event => event.phase === 'downloading');
    assert.ok(received.length >= 2);
    assert.equal(received[0]!.bytes, 0);
    assert.equal(received.at(-1)!.bytes, archive.length);
    assert.ok(received.every((event, index) => event.bytes >= (received[index - 1]?.bytes ?? 0)));
    assert.ok(received.every(event => event.total === (knownTotal ? archive.length : undefined)));
    assert.deepEqual(events.filter(event => event.phase !== 'downloading').map(event => event.phase), ['requesting', 'extracting', 'verifying', 'publishing']);
  });
}

for (const phase of ['downloading', 'publishing'] as const) {
  test(`cancelling at ${phase} progress preserves the previous verified copy`, async context => {
    const directory = await root(context);
    const request = {reference, kinds: ['fasta'] as const, root: directory, mode: 'refresh' as const};
    const previous = await resolveGenomeCache(request, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false)))});
    const controller = new AbortController();
    await assert.rejects(resolveGenomeCache(request, {
      signal: controller.signal, secrets: {}, fetchImpl: response(zip(members(false), 8, {zip64: true})),
      onProgress: event => {
        if (event.phase === phase && (event.phase !== 'downloading' || event.bytes > 0)) { controller.abort(); }
      },
    }));
    assert.equal(controller.signal.aborted, true);
    assert.equal(await readFile(previous.fasta!, 'utf8'), fasta);
    assert.deepEqual(await readdir(join(directory, 'ncbi-accessions-cache')), [reference.id]);
  });
}

test('independent NCBI artifact requests are honored, discovered, and merged without deleting unchecked files', async context => {
  const directory = await root(context);
  const request = {reference, root: directory, mode: 'refresh' as const};
  const calls: string[][] = [];
  const fetchImpl: typeof fetch = async input => {
    const selected = new URL(String(input)).searchParams.getAll('include_annotation_type');
    calls.push(selected);
    const files = members().filter(([name]) => !name.endsWith('.fna') || selected.includes('GENOME_FASTA'))
      .filter(([name]) => !name.endsWith('.gff') || selected.includes('GENOME_GFF'));
    return response(zip(files, 8, {zip64: true}))(input);
  };
  const annotation = await resolveGenomeCache({...request, kinds: ['gff3']}, {signal: signal(), secrets: {}, fetchImpl});
  assert.deepEqual(calls, [['GENOME_GFF']]);
  assert.equal(annotation.fasta, undefined);
  assert.equal(annotation.fasta_sha256, undefined);
  assert.equal(await readFile(annotation.gff3!, 'utf8'), gff3);
  const scan = await scanAccessionCaches([directory]);
  assert.equal(scan.copies[0]?.state, 'verified');
  assert.equal(scan.copies[0]?.fasta_sha256, undefined);
  const catalog = validateAccessionCatalog(applyCacheScan(emptyAccessionCatalog(), scan));
  assert.equal(catalog.accessions[0]?.cached_copies[0]?.gff3_sha256, annotation.gff3_sha256);

  const sequence = await resolveGenomeCache({...request, kinds: ['fasta']}, {signal: signal(), secrets: {}, fetchImpl});
  assert.deepEqual(calls[1], ['GENOME_FASTA']);
  assert.equal(await readFile(sequence.fasta!, 'utf8'), fasta);
  assert.equal(sequence.gff3, undefined, 'unrequested files are not returned as consumed artifacts');
  const offline = await resolveGenomeCache({...request, kinds: ['fasta', 'gff3'], mode: 'reuse'}, {
    signal: signal(), secrets: {}, fetchImpl: async () => assert.fail('both artifacts must now be reusable offline'),
  });
  assert.equal(offline.fasta_sha256, sequence.fasta_sha256);
  assert.equal(offline.gff3_sha256, annotation.gff3_sha256);
  assert.equal(await readFile(offline.gff3!, 'utf8'), gff3);
  await assert.rejects(resolveGenomeCache({...request, kinds: ['fasta']}, {
    signal: signal(), secrets: {}, fetchImpl: response(zip(members(false).map(([name, content]) => [name, name.startsWith(prefix) && name.endsWith('.fna') ? '>synthetic\nTTTTNN\n' : content]))),
  }), /Refresh sequence and annotation together/);
  assert.equal(await readFile(sequence.fasta!, 'utf8'), fasta, 'changed sequence cannot silently retain old annotation');
  await resolveGenomeCache({...request, kinds: ['gff3']}, {signal: signal(), secrets: {}, fetchImpl});
  assert.equal(await readFile(sequence.fasta!, 'utf8'), fasta, 'refreshing annotation preserves verified FASTA');
});

test('an unavailable annotation-only request publishes no empty cache and preserves prior files', async context => {
  const directory = await root(context);
  const request = {reference, root: directory, mode: 'refresh' as const};
  const previous = await resolveGenomeCache({...request, kinds: ['fasta']}, {signal: signal(), secrets: {}, fetchImpl: response(zip(members(false)))});
  await assert.rejects(resolveGenomeCache({...request, kinds: ['gff3']}, {
    signal: signal(), secrets: {}, fetchImpl: response(zip([['ncbi_dataset/data/assembly_data_report.jsonl', report]])),
  }), /unavailable/);
  assert.equal(await readFile(previous.fasta!, 'utf8'), fasta);
  assert.equal((await scanAccessionCaches([directory])).copies[0]?.fasta_sha256, previous.fasta_sha256);
});

test('cache requests reject undeclared artifacts and empty/duplicate selections before downloading', async context => {
  const directory = await root(context);
  const registry = new GenomeProviderRegistry([{...ncbiProvider, artifacts: [{kind: 'fasta', label: 'Only sequence'}]}]);
  for (const kinds of [[], ['gff3'], ['fasta', 'fasta']] as const) {
    await assert.rejects(resolveGenomeCache({reference, root: directory, mode: 'refresh', kinds}, {
      signal: signal(), secrets: {}, fetchImpl: async () => assert.fail('invalid selections must not access the network'),
    }, registry), /requested files/);
  }
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
    assert.equal(await readFile(old.fasta!, 'utf8'), fasta);
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
  assert.equal(await readFile(old.fasta!, 'utf8'), fasta);
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
  await writeFile(result.fasta!, '>changed\nAAAA\n');
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
