import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {resolveGenomeCache} from '../../src/accessions/cache.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {GenomeProviderRegistry} from '../../src/accessions/provider.js';
import {deleteAccessionCaches} from '../../src/accessions/cache-discovery.js';

const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};

test('a provider disk error discards its staging files without touching the verified entry', async context => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-disk-error-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const directory = join(root, ncbiProvider.cacheDirectory, reference.id);
  await mkdir(directory, {recursive: true});
  const fasta = '>synthetic\nACGT\n';
  await writeFile(join(directory, 'genomic.fna'), fasta);
  await writeFile(join(directory, 'checksums.json'), JSON.stringify({fasta: createHash('sha256').update(fasta).digest('hex')}));
  await writeFile(join(directory, 'genome.json'), JSON.stringify({reference, metadata: null, facts: {}, annotation: 'not-requested'}));
  const registry = new GenomeProviderRegistry([{...ncbiProvider, async download(_reference, _kinds, staging) {
    // Deletion and download cannot race the same identity.
    await assert.rejects(deleteAccessionCaches([root], reference), /writer/);
    await writeFile(join(staging, 'genomic.fna'), '>partial\n');
    throw Object.assign(new Error('Synthetic disk-full failure'), {code: 'ENOSPC'});
  }}]);
  await assert.rejects(resolveGenomeCache({reference, kinds: ['fasta'], root, mode: 'refresh'}, {
    signal: new AbortController().signal, secrets: {},
  }, registry), {code: 'ENOSPC'});
  assert.equal(await readFile(join(directory, 'genomic.fna'), 'utf8'), fasta);
  assert.deepEqual(await readdir(join(root, ncbiProvider.cacheDirectory)), [reference.id]);
  assert.equal((await resolveGenomeCache({reference, kinds: ['fasta'], root, mode: 'reuse'}, {
    signal: new AbortController().signal, secrets: {},
  }, registry)).downloaded, false);
});

test('a pre-cancelled operation neither fetches nor creates an output root', async context => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-pre-cancel-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolveGenomeCache({reference, kinds: ['fasta'], root: join(root, 'new'), mode: 'refresh'}, {
    signal: controller.signal, secrets: {}, fetchImpl: async () => {assert.fail('must not fetch');},
  }));
  assert.deepEqual(await readdir(root), []);
});
