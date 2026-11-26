import assert from 'node:assert/strict';
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {deleteAccessionCaches} from '../../src/accessions/cache-discovery.js';
import {resolveGenomeCache, withGenomeCache} from '../../src/accessions/cache.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {GenomeProviderRegistry} from '../../src/accessions/provider.js';

function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
const context = () => ({signal: new AbortController().signal, secrets: {}});

for (const [crossRoot, kind] of [[false, 'fasta'], [true, 'fasta'], [false, 'gff3'], [true, 'gff3']] as const) {
  test(`a ${crossRoot ? 'cross-root' : 'same-root'} ${kind} workflow reader excludes refresh and deletion through its copy`, async testContext => {
    const root = await mkdtemp(join(tmpdir(), 'genopilot-consumer-'));
    testContext.after(() => rm(root, {recursive: true, force: true}));
    let generation = 'ACGT';
    const filename = kind === 'fasta' ? 'genomic.fna' : 'genomic.gff';
    const content = () => kind === 'fasta' ? `>synthetic\n${generation}\n` : `##gff-version 3\n##generation ${generation}\n`;
    const original = content();
    const registry = new GenomeProviderRegistry([{
      ...ncbiProvider,
      async download(_reference, _kinds, staging) {
        await writeFile(join(staging, filename), content());
        return {files: {[kind]: filename}, metadata: null, facts: {}, annotation: kind === 'gff3' ? 'available' : 'not-requested'};
      },
    }]);
    const request = {reference, root, kinds: [kind], mode: 'reuse' as const};
    const genome = await resolveGenomeCache(request, context(), registry);
    const copying = latch();
    const continueCopy = latch();
    const copied = join(root, 'run.fna');
    const reader = withGenomeCache({...request, ...(crossRoot ? {root: join(root, 'other'), copy: {path: dirname(genome[kind]!), [`${kind}_sha256`]: genome[`${kind}_sha256`]}} : {})}, context(), async verified => {
      copying.release();
      await continueCopy.promise;
      await copyFile(verified[kind]!, copied);
      return verified;
    }, registry);
    testContext.after(() => continueCopy.release());
    await copying.promise;
    generation = 'TTTT';
    await assert.rejects(resolveGenomeCache({...request, mode: 'refresh'}, context(), registry), /holds this entry/);
    await assert.rejects(deleteAccessionCaches([root], reference, registry), /holds this entry/);
    continueCopy.release();
    assert.equal((await reader).downloaded, false);
    assert.equal(await readFile(copied, 'utf8'), original);
    await resolveGenomeCache({...request, mode: 'refresh'}, context(), registry);
    assert.equal(await readFile(copied, 'utf8'), original);
    await deleteAccessionCaches([root], reference, registry);
  });
}

test('consumer failure releases the lock, but never marks a copy successful', async testContext => {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-consumer-failure-'));
  testContext.after(() => rm(root, {recursive: true, force: true}));
  const registry = new GenomeProviderRegistry([{
    ...ncbiProvider,
    async download(_reference, _kinds, staging) {
      await writeFile(join(staging, 'genomic.fna'), '>synthetic\nACGT\n');
      return {files: {fasta: 'genomic.fna'}, metadata: null, facts: {}, annotation: 'not-requested'};
    },
  }]);
  const request = {reference, root, kinds: ['fasta'] as const, mode: 'reuse' as const};
  await assert.rejects(withGenomeCache(request, context(), async () => { throw new Error('injected-copy-failure'); }, registry), /injected-copy-failure/);
  await deleteAccessionCaches([root], reference, registry);
});
