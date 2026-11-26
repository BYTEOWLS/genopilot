import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {scanAccessionCaches} from '../../src/accessions/cache-discovery.js';
import {resolveGenomeCache} from '../../src/genome-sources/cache.js';
import {ncbiProvider} from '../../src/genome-sources/ncbi.js';
import {GenomeProviderRegistry} from '../../src/genome-sources/provider.js';

const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
const fasta = '>first\nACGT\n>second\nNNNN\n';
const signal = () => new AbortController().signal;

test('FASTA-only reuse ignores optional annotation damage and never exposes unverified GFF3', async context => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-required-files-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let downloads = 0;
  const registry = new GenomeProviderRegistry([{
    ...ncbiProvider,
    fields: [{id: 'token', label: 'Token', kind: 'secret', required: true}],
    async download(_reference, _kinds, staging) {
      downloads += 1;
      await writeFile(join(staging, 'genomic.fna'), fasta);
      await writeFile(join(staging, 'genomic.gff'), '##gff-version 3\n');
      return {files: {fasta: 'genomic.fna', gff3: 'genomic.gff'}, metadata: null, facts: {}, annotation: 'available'};
    },
  }]);
  const request = {reference, root, mode: 'reuse' as const, kinds: ['fasta', 'gff3'] as const};
  const initial = await resolveGenomeCache(request, {signal: signal(), secrets: {token: 'synthetic'}}, registry);
  const directory = join(root, ncbiProvider.cacheDirectory, reference.id);
  const copy = {path: directory, fasta_sha256: initial.fasta_sha256, gff3_sha256: initial.gff3_sha256};
  const offline = () => ({signal: signal(), secrets: {}, fetchImpl: async () => {assert.fail('must not access the network');}});

  for (const damage of ['none', 'changed', 'missing', 'malformed-checksum']) {
    if (damage === 'changed') {
      await writeFile(initial.gff3!, 'changed bytes');
    } else if (damage === 'missing') {
      await rm(initial.gff3!);
    } else if (damage === 'malformed-checksum') {
      await writeFile(join(directory, 'checksums.json'), JSON.stringify({fasta: initial.fasta_sha256, gff3: 'invalid'}));
    }
    for (const snapshot of [undefined, copy]) {
      const reused = await resolveGenomeCache({...request, kinds: ['fasta'], copy: snapshot}, offline(), registry);
      assert.equal(reused.downloaded, false, damage);
      assert.equal(reused.fasta_sha256, initial.fasta_sha256, damage);
      assert.equal(await readFile(reused.fasta, 'utf8'), fasta);
      assert.equal(reused.gff3, undefined, damage);
      assert.equal(reused.gff3_sha256, undefined, damage);
      assert.equal(reused.annotation, 'not-requested', damage);
    }
    const scan = await scanAccessionCaches([root], undefined, registry);
    if (damage === 'none') {
      assert.equal(scan.copies[0]?.state, 'verified');
      assert.equal((await resolveGenomeCache({...request, copy}, offline(), registry)).gff3_sha256, initial.gff3_sha256);
    } else {
      assert.notEqual(scan.copies[0]?.state, 'verified', damage);
      await assert.rejects(resolveGenomeCache({...request, copy}, offline(), registry), /checksums/);
      await assert.rejects(resolveGenomeCache(request, offline(), registry), /Configure/);
    }
  }
  await writeFile(initial.fasta, '>changed\nTTTT\n');
  await assert.rejects(resolveGenomeCache({...request, kinds: ['fasta'], copy}, offline(), registry), /checksums/);
  assert.equal(downloads, 1);
});

for (const [position, emptyRecord] of [
  ['only', '>empty\n'],
  ['first', '>empty\n>good\nACGT\n'],
  ['middle', '>first\nACGT\n>empty\n>last\nNNNN\n'],
  ['last', '>good\nACGT\n>empty\n'],
] as const) {
  test(`rejects an empty ${position} FASTA record before publication and preserves the old copy`, async context => {
    const root = await mkdtemp(join(tmpdir(), 'genopilot-empty-record-'));
    context.after(() => rm(root, {recursive: true, force: true}));
    let content = fasta;
    const registry = new GenomeProviderRegistry([{
      ...ncbiProvider,
      async download(_reference, _kinds, staging) {
        await writeFile(join(staging, 'genomic.fna'), content);
        return {files: {fasta: 'genomic.fna'}, metadata: null, facts: {}, annotation: 'not-requested'};
      },
    }]);
    const request = {reference, root, mode: 'refresh' as const, kinds: ['fasta'] as const};
    const previous = await resolveGenomeCache(request, {signal: signal(), secrets: {}}, registry);
    content = emptyRecord;
    await assert.rejects(resolveGenomeCache(request, {signal: signal(), secrets: {}}, registry), /empty/);
    assert.equal(await readFile(previous.fasta, 'utf8'), fasta);
    const scan = await scanAccessionCaches([root], undefined, registry);
    assert.equal(scan.copies.length, 1);
    assert.equal(scan.copies[0]?.state, 'verified');
    assert.equal(scan.copies[0]?.fasta_sha256, previous.fasta_sha256);
    const fresh = join(root, 'fresh');
    await assert.rejects(resolveGenomeCache({...request, root: fresh}, {signal: signal(), secrets: {}}, registry), /empty/);
    assert.deepEqual((await scanAccessionCaches([fresh], undefined, registry)).copies, []);
  });
}
