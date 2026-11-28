import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import test from 'node:test';
import {resolveGenomeCache} from '../../src/accessions/cache.js';
import {syntheticProvider} from './fixtures/provider.js';
import {GenomeProviderRegistry} from '../../src/accessions/provider.js';
import {waitFor} from '../wait.js';

for (const phase of ['downloading', 'awaiting-copy', 'acknowledged'] as const) {
  test(`genome entry handles consumer EOF while ${phase}`, async context => {
    const root = await mkdtemp(join(tmpdir(), 'genopilot-entry-'));
    context.after(() => rm(root, {recursive: true, force: true}));
    const provider = syntheticProvider('synthetic');
    const reference = {source: provider.id, id: 'genome-1', parameters: {release: 'pinned'}};
    const request = {reference, root, mode: 'refresh' as const, kinds: ['fasta'] as const};
    const original = '>original\nACGT\n';
    const registry = new GenomeProviderRegistry([{
      ...provider,
      async download(_reference, _kinds, staging) {
        await writeFile(join(staging, 'genomic.fna'), original);
        return {files: {fasta: 'genomic.fna'}, metadata: null, facts: {}, annotation: 'not-requested'};
      },
    }]);
    const previous = await resolveGenomeCache(request, {signal: new AbortController().signal, secrets: {}}, registry);
    // Inject the provider in a real child process: no network or timing assumptions.
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
      import {writeFile} from 'node:fs/promises';
      import {join} from 'node:path';
      import {syntheticProvider} from ${JSON.stringify(new URL('./fixtures/provider.ts', import.meta.url).href)};
      import {accessionSources} from ${JSON.stringify(new URL('../../src/accessions/registry.ts', import.meta.url).href)};
      const provider = syntheticProvider('synthetic');
      provider.download = async (_reference, _kinds, staging, context) => {
        await writeFile(join(staging, 'genomic.fna'), '>replacement\\nTTTT\\n');
        if (${JSON.stringify(phase)} === 'downloading') {
          await new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              process.send('aborted');
              reject(context.signal.reason);
            }, {once: true});
            process.send('downloading');
          });
        }
        return {files: {fasta: 'genomic.fna'}, metadata: null, facts: {}, annotation: 'not-requested'};
      };
      accessionSources.register(provider);
      await import(${JSON.stringify(new URL('../../src/accessions/entry.ts', import.meta.url).href)});
      process.disconnect();
    `], {stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: {...process.env, HOME: root}});
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
    context.after(async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
      await exited;
    });
    assert.ok(child.stdin && child.stdout && child.stderr);
    let closed = false;
    let stderr = '';
    const messages: unknown[] = [];
    let genome: {fasta_sha256?: string} | undefined;
    child.once('close', () => { closed = true; });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('message', message => messages.push(message));
    const lines = createInterface({input: child.stdout});
    lines.on('line', line => { genome = JSON.parse(line); });
    child.stdin.write(`${JSON.stringify(request)}\n`);
    if (phase === 'downloading') {
      await waitFor(() => messages.includes('downloading'), 'provider begins transfer', () => stderr);
      child.stdin.end();
    } else {
      await waitFor(() => genome !== undefined, 'verified paths are offered', () => stderr);
      child.stdin.end(phase === 'acknowledged' ? '{"copied":true}\n' : undefined);
    }
    await waitFor(() => closed, 'resolver exits after consumer EOF', () => stderr);
    assert.equal(child.exitCode, phase === 'acknowledged' ? 0 : 1, stderr);
    if (phase === 'downloading') {
      assert.ok(messages.includes('aborted'));
      assert.equal(genome, undefined);
      assert.equal(await readFile(previous.fasta!, 'utf8'), original);
    } else {
      assert.ok(genome?.fasta_sha256);
    }
    assert.deepEqual(await readdir(join(root, provider.cacheDirectory)), [reference.id]);
  });
}
