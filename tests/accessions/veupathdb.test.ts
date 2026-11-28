import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse, stringify} from 'yaml';
import test from 'node:test';
import {artifactFiles, fileKinds, GenomeProviderRegistry, type FileKind, type ProviderContext} from '../../src/accessions/provider.js';
import {veupathdbProvider, veupathdbSites} from '../../src/accessions/provider/veupathdb/index.js';
import {resolveGenomeCache} from '../../src/accessions/cache.js';
import {applyCacheScan, scanAccessionCaches} from '../../src/accessions/cache-discovery.js';
import {emptyAccessionCatalog, recordedCacheState, validateAccessionCatalog} from '../../src/accessions/catalog.js';
import {snapshotGenomeCopy, type RemoteGenomeInput} from '../../src/workflows/genome-input.js';

const registry = new GenomeProviderRegistry([veupathdbProvider]);
const params = {site: 'FungiDB', release: 71, organism_abbreviation: 'ExampleA'};
const reference = {source: 'veupathdb', id: 'FungiDB-71_ExampleA', parameters: params};
const sequences: Record<FileKind, string> = {
  fasta: '>chr1\nACGT\n>chr2\nNNAA\n',
  gff3: '##gff-version 3\nchr1\tsynthetic\tprotein_coding_gene\t1\t4\t.\t+\t.\tID=gene1\nchr2\tsynthetic\tgene\t1\t4\t.\t+\t.\tID=gene2\n',
  proteins: '>protein1\nMPEPTIDEX*\n', transcripts: '>transcript1\nACGU\n', cds: '>cds1\nATGTAA\n',
};
const suffix: Record<FileKind, string> = {fasta: '_Genome.fasta', gff3: '.gff', proteins: '_AnnotatedProteins.fasta', transcripts: '_AnnotatedTranscripts.fasta', cds: '_AnnotatedCDSs.fasta'};
function api(options: {release?: number; count?: number; statuses?: Partial<Record<FileKind, number>>; bodies?: Partial<Record<FileKind, string>>; auth?: number; duplicate?: boolean; project?: string; attributes?: Record<string, unknown>} = {}) {
  const calls: {url: URL; method: string}[] = [];
  const release = options.release ?? 71;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({url, method: init?.method ?? 'GET'});
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-test-key');
    assert.equal(init?.redirect, 'error');
    assert.ok(!url.href.includes('synthetic-test-key'));
    if (options.auth) {
      return new Response('untrusted body synthetic-test-key', {status: options.auth});
    }
    const site = veupathdbSites.find(site => site.host === url.host)!.id;
    if (url.pathname.endsWith('/a/service')) {
      return Response.json({projectId: options.project ?? site, buildNumber: String(release)});
    }
    if (url.pathname.endsWith('/reports/standard')) {
      const config = JSON.parse(url.searchParams.get('reportConfig')!);
      const count = options.count ?? 1;
      const records = Array.from({length: count}, (_, index) => ({
        attributes: {primary_key: index === 0 ? 'Example organism Alpha' : `Other organism ${index}`, name_for_filenames: index === 0 ? 'ExampleA' : `Other${index}`, project_id: site, genome_version: 'synthetic-assembly', ...options.attributes},
        id: [{name: 'source_id', value: `SYNTHETIC_${index}`}, {name: 'project_id', value: site}], tables: {}, tableErrors: [],
      }));
      const offset = options.duplicate ? 0 : config.pagination.offset;
      const page = records.slice(offset, offset + config.pagination.numRecords);
      return Response.json({records: page, meta: {totalCount: count, responseCount: page.length}});
    }
    const kind = fileKinds.find(kind => url.pathname.endsWith(suffix[kind]))!;
    assert.ok(kind, url.href);
    assert.ok(url.pathname.includes(`/release-${params.release}/`) || url.pathname.includes('/release-70/'));
    const status = options.statuses?.[kind] ?? 200;
    return new Response(init?.method === 'HEAD' ? null : options.bodies?.[kind] ?? sequences[kind], {status});
  };
  return {calls, fetchImpl};
}
const context = (fetchImpl: typeof fetch): ProviderContext => ({fetchImpl, signal: new AbortController().signal, secrets: {'api-key': 'synthetic-test-key'}, site: 'FungiDB'});

for (const site of veupathdbSites) {
  test(`VEuPathDB site ${site.id} uses its own host and pinned search references`, async () => {
    const mock = api();
    const ctx = {...context(mock.fetchImpl), site: site.id};
    const results = await veupathdbProvider.search!('organism alpha', ctx);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]?.reference, {source: 'veupathdb', id: `${site.id}-71_ExampleA`, parameters: {...params, site: site.id}});
    assert.ok(mock.calls.every(call => call.url.hostname === site.host));
    assert.equal((await veupathdbProvider.search!('missing', ctx)).length, 0);
  });
}

test('VEuPathDB discovery pages the organism listing, matches all name/ID words, and refuses repeated pages', async () => {
  const mock = api({count: 201});
  assert.equal((await veupathdbProvider.search!('Example Alpha', context(mock.fetchImpl))).length, 1);
  assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/reports/standard')).length, 2);
  await assert.rejects(veupathdbProvider.search!('', context(mock.fetchImpl)), /Enter/);
  await assert.rejects(veupathdbProvider.search!('alpha', context(api({count: 400, duplicate: true}).fetchImpl)), /duplicate/);
  await assert.rejects(veupathdbProvider.search!('alpha', context(api({project: 'OtherDB'}).fetchImpl)), /selected site/);
});

test('VEuPathDB validates canonical identity, site selection, release, parameters, and metadata', async () => {
  assert.deepEqual(await veupathdbProvider.resolveExact(reference.id, context(api().fetchImpl)), reference);
  for (const parameters of [{...params, release: 70}, {...params, release: '71'}, {...params, token: 'forbidden'}, {...params, site: 'UnknownDB'}, {...params, organism_abbreviation: '../escape'}]) {
    assert.throws(() => veupathdbProvider.validateReference(reference.id, parameters));
  }
  await assert.rejects(veupathdbProvider.resolveExact(reference.id, {...context(api().fetchImpl), site: 'ToxoDB'}), /another site/);
  assert.throws(() => veupathdbProvider.validateMetadata({...params, 'api-key': 'not-allowed'}));
  const historical = {...reference, id: 'FungiDB-70_ExampleA', parameters: {...params, release: 70}};
  assert.deepEqual(await veupathdbProvider.lookupMetadata!(historical, context(api().fetchImpl)), historical.parameters);
});

test('organism reports request shared facts and preserve normalized mappings through catalog YAML', async () => {
  const mock = api({attributes: {strain: 'Synthetic strain', species: 'Synthetic species', ncbi_tax_id: '123',
    annotation_version: '2025-01', contigCount: '5', supercontigCount: '2', chromosomeCount: '1', megabps: '3.14'}});
  const facts = await veupathdbProvider.lookupMetadata!(reference, context(mock.fetchImpl));
  const catalog = validateAccessionCatalog(parse(stringify({...emptyAccessionCatalog(), accessions: [
    {...reference, metadata: facts, cached_copies: []},
  ]})));
  const mapped = veupathdbProvider.mapMetadata(catalog.accessions[0]!.metadata);
  assert.deepEqual(mapped.assembly, {organism: 'Example organism Alpha', strain: 'Synthetic strain', tax_id: 123});
  assert.deepEqual(mapped.statistics, {number_of_contigs: 5});
  assert.ok(mapped.retrieved_at);
  assert.equal(mapped.provider_attributes.find(attribute => attribute.id === 'megabps')?.value, 3.14);
  const request = mock.calls.find(call => call.url.pathname.endsWith('/reports/standard'))!;
  const config = JSON.parse(request.url.searchParams.get('reportConfig')!);
  for (const field of ['strain', 'ncbi_tax_id', 'contigCount', 'annotation_version', 'megabps']) {
    assert.ok(config.attributes.includes(field));
  }
  assert.equal(config.attributeFormat, 'text');
});

test('malformed optional organism facts stay unavailable; invalid persisted facts are rejected', async () => {
  const facts = await veupathdbProvider.lookupMetadata!(reference, context(api({attributes: {
    strain: 'N/A', ncbi_tax_id: '0', contigCount: '-1', supercontigCount: '1.5', chromosomeCount: '9007199254740993', megabps: 'unknown',
  }}).fetchImpl));
  const mapped = veupathdbProvider.mapMetadata(facts);
  assert.equal(mapped.assembly.strain, undefined);
  assert.equal(mapped.assembly.tax_id, undefined);
  assert.deepEqual(mapped.statistics, {});
  assert.ok(!mapped.provider_attributes.some(attribute => ['megabps', 'supercontig_count', 'chromosome_count'].includes(attribute.id)));
  for (const invalid of [{number_of_contigs: -1}, {number_of_contigs: '5'}, {tax_id: 0}, {megabps: Infinity}, {retrieved_at: 'invalid'}]) {
    assert.throws(() => veupathdbProvider.validateMetadata({...params, ...invalid}));
  }
});

test('missing/rejected credentials, redirects/network errors, and cancellation do not expose secrets', async () => {
  let calls = 0;
  const never: typeof fetch = async () => { calls++; throw new Error('synthetic-test-key'); };
  await assert.rejects(veupathdbProvider.search!('alpha', {...context(never), secrets: {}}), /Configure/);
  assert.equal(calls, 0);
  for (const status of [401, 403]) {
    await assert.rejects(veupathdbProvider.search!('alpha', context(api({auth: status}).fetchImpl)), error => error instanceof Error && !error.message.includes('synthetic-test-key') && error.message.includes('rejected access'));
  }
  await assert.rejects(veupathdbProvider.search!('alpha', context(never)), error => error instanceof Error && !error.message.includes('synthetic-test-key'));
  const abort = new AbortController();
  abort.abort(new Error('cancel-marker'));
  await assert.rejects(veupathdbProvider.search!('alpha', {...context(never), signal: abort.signal}), /cancel-marker/);
});

test('all genome artifacts publish separately, survive partial refresh, and reuse without credentials or network', async t => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-veupathdb-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const mock = api();
  const request = {reference, kinds: fileKinds, root, mode: 'refresh' as const};
  const downloaded = await resolveGenomeCache(request, context(mock.fetchImpl), registry);
  for (const kind of fileKinds) {
    assert.equal(await readFile(downloaded[kind]!, 'utf8'), sequences[kind]);
    assert.match(downloaded[`${kind}_sha256`]!, /^[a-f0-9]{64}$/);
  }
  assert.equal(downloaded.downloaded, true);
  assert.equal((downloaded.metadata as {organism?: string}).organism, 'Example organism Alpha');
  const files = mock.calls.filter(call => call.url.pathname.includes('/raw-files/'));
  assert.equal(files.length, 5);
  assert.ok(files.some(call => call.url.pathname.endsWith('_AnnotatedCDSs.fasta')));
  assert.ok(files.every(call => !call.url.href.includes('Current_Release')));
  const refreshed = await resolveGenomeCache({...request, kinds: ['proteins']}, context(api().fetchImpl), registry);
  assert.equal(refreshed.fasta, undefined);
  const offline: ProviderContext = {signal: new AbortController().signal, secrets: {}, fetchImpl: async () => assert.fail('offline reuse called the provider')};
  const reused = await resolveGenomeCache({...request, mode: 'reuse'}, offline, registry);
  assert.equal(reused.downloaded, false);
  assert.equal(reused.fasta_sha256, downloaded.fasta_sha256);
  const reordered = {...reference, parameters: {organism_abbreviation: 'ExampleA', release: 71, site: 'FungiDB'}};
  const snapshotReuse = await resolveGenomeCache({...request, reference: reordered, kinds: ['fasta'], mode: 'reuse', copy: {
    path: join(root, veupathdbProvider.cacheDirectory, reference.id), fasta_sha256: downloaded.fasta_sha256,
  }}, offline, registry);
  assert.equal(snapshotReuse.downloaded, false, 'YAML key ordering cannot invalidate a pinned copy');
  const scan = await scanAccessionCaches([root], () => new Date('2026-01-01'), registry);
  const catalog = applyCacheScan(emptyAccessionCatalog(), scan);
  assert.equal(catalog.accessions[0]?.cached_copies[0]?.cds_sha256, downloaded.cds_sha256);
  assert.deepEqual(validateAccessionCatalog(catalog), catalog);
  const damaged = {...catalog.accessions[0]!, cached_copies: [...catalog.accessions[0]!.cached_copies, {...catalog.accessions[0]!.cached_copies[0]!, proteins_sha256: 'f'.repeat(64)}]};
  assert.equal(recordedCacheState(damaged), 'conflict');
  await writeFile(reused.proteins!, '>bad\n123\n');
  const damagedScan = await scanAccessionCaches([root], undefined, registry);
  assert.equal(damagedScan.copies[0]?.state, 'checksum-invalid');
  const genomeOnly = await resolveGenomeCache({...request, kinds: ['fasta'], mode: 'reuse'}, offline, registry);
  assert.equal(genomeOnly.proteins, undefined, 'genome-only reuse never returns unverified extra artifacts');
});

test('cancellation during a VEuPathDB refresh leaves the previous verified artifacts intact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-veupathdb-cancel-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const request = {reference, kinds: ['fasta'] as const, root, mode: 'refresh' as const};
  const before = await resolveGenomeCache(request, context(api().fetchImpl), registry);
  const abort = new AbortController();
  await assert.rejects(resolveGenomeCache(request, {...context(api().fetchImpl), signal: abort.signal,
    onProgress: progress => {
      if (progress.phase === 'downloading' && progress.bytes > 0) {
        abort.abort(new Error('cancel-marker'));
      }
    },
  }, registry), /cancel-marker/);
  assert.equal(await readFile(before.fasta!, 'utf8'), sequences.fasta);
  const scan = await scanAccessionCaches([root], undefined, registry);
  assert.equal(scan.copies[0]?.state, 'verified');
});

test('protein-only caches do not masquerade as genomes or workflow snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-protein-only-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const downloaded = await resolveGenomeCache({reference, kinds: ['proteins'], root, mode: 'refresh'}, context(api().fetchImpl), registry);
  assert.equal(downloaded.fasta, undefined);
  const scan = await scanAccessionCaches([root], undefined, registry);
  const catalog = applyCacheScan(emptyAccessionCatalog(), scan);
  assert.equal(scan.copies[0]?.state, 'verified');
  const input: RemoteGenomeInput = {source: 'remote', reference, cache_mode: 'reuse'};
  snapshotGenomeCopy(input, ['fasta'], catalog.accessions);
  assert.equal(input.copy, undefined);
  assert.equal(validateAccessionCatalog(catalog).schema_version, 3);
});

test('failed refresh, unavailable pinned release, and invalid artifact contents preserve old verified files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-veupathdb-failure-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const request = {reference, kinds: fileKinds, root, mode: 'refresh' as const};
  const before = await resolveGenomeCache(request, context(api().fetchImpl), registry);
  for (const mock of [api({statuses: {fasta: 404}}), api({statuses: {gff3: 500}}), api({bodies: {proteins: '<html>error</html>'}}), api({bodies: {cds: '>empty\n'}})]) {
    await assert.rejects(resolveGenomeCache(request, context(mock.fetchImpl), registry));
    assert.equal(await readFile(before.fasta!, 'utf8'), sequences.fasta);
    assert.equal(await readFile(before.proteins!, 'utf8'), sequences.proteins);
  }
  await assert.rejects(resolveGenomeCache({...request, kinds: ['fasta']}, context(api({bodies: {fasta: '>changed\nACGT\n'}}).fetchImpl), registry), /sequence changed/);
  const unavailable = await resolveGenomeCache({...request, kinds: ['fasta', 'gff3']}, context(api({statuses: {gff3: 404}}).fetchImpl), registry);
  assert.equal(unavailable.annotation, 'unavailable');
  assert.equal(unavailable.gff3, undefined);
  assert.equal(await readFile(join(root, veupathdbProvider.cacheDirectory, reference.id, artifactFiles.proteins), 'utf8'), sequences.proteins);
});
