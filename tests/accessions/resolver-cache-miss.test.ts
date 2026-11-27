import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {build} from 'esbuild';

const execute = promisify(execFile);
const digest = (content: string) => createHash('sha256').update(content).digest('hex');

test('bundled resolver downloads provider references on cache misses through the Python copy boundary', async context => {
  const temporary = await mkdtemp(join(tmpdir(), 'genopilot-cache-miss-'));
  context.after(() => rm(temporary, {recursive: true, force: true}));
  const packaged = join(temporary, 'package');
  const scripts = join(packaged, 'workflows/shared/scripts');
  const unrelated = join(temporary, 'unrelated');
  await mkdir(scripts, {recursive: true});
  await mkdir(unrelated);
  await copyFile(resolve('package.json'), join(packaged, 'package.json'));
  await mkdir(join(packaged, 'runtime'));
  for (const file of ['pixi.toml', 'pixi.lock']) {
    await copyFile(resolve('runtime', file), join(packaged, 'runtime', file));
  }
  for (const file of ['resolve_input.py', 'genome_source.py', 'provenance.py']) {
    await copyFile(resolve('workflows/shared/scripts', file), join(scripts, file));
  }
  // Test-only startup registration; production has no plugin loader or test-provider switch.
  await build({
    stdin: {contents: `
      import {genomeSources} from './src/accessions/registry.ts';
      import {syntheticProvider} from './tests/accessions/fixtures/provider.ts';
      genomeSources.register(syntheticProvider('synthetic-a'));
      genomeSources.register(syntheticProvider('synthetic-b'));
      await import('./src/accessions/entry.ts');
    `, resolveDir: process.cwd()},
    outfile: join(packaged, 'dist/genome-source.js'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
  });
  const callsPath = join(temporary, 'calls.tsv');
  await writeFile(callsPath, '');
  const env = {...process.env, HOME: temporary, GENOPILOT_NODE_EXECUTABLE: process.execPath,
    GENOPILOT_TEST_PROVIDER_CALLS: callsPath};
  const calls = () => readFile(callsPath, 'utf8');

  async function run(source: string, role: string, id: string, root: string, name: string) {
    const destination = join(temporary, name);
    const input = {source: 'remote', reference: {source, id, parameters: {release: 'pinned'}}, cache_mode: 'reuse'};
    await execute('python3', [join(scripts, 'resolve_input.py'), '--role', role,
      '--input-json', JSON.stringify(input), '--output-root', root,
      '--fasta-destination', `${destination}.fasta`, '--fasta-provenance', `${destination}.fasta.json`,
      ...(role === 'reference' ? ['--gff3-destination', `${destination}.gff3`, '--gff3-provenance', `${destination}.gff3.json`] : []),
    ], {cwd: unrelated, env});
    return {destination, reference: input.reference};
  }

  for (const role of ['reference', 'target', 'backbone']) {
    await context.test(`${role} requests only its required files and isolates providers sharing an ID`, async () => {
      const root = join(temporary, role);
      for (const source of ['synthetic-a', 'synthetic-b']) {
        const name = `${role}-${source}`;
        const before = await calls();
        const {destination, reference} = await run(source, role, 'same-genome', root, name);
        assert.equal(await calls(), `${before}${source}\tsame-genome\t${role === 'reference' ? 'fasta,gff3' : 'fasta'}\n`);
        const cache = join(root, `${source}-files`, reference.id);
        const checksums = JSON.parse(await readFile(join(cache, 'checksums.json'), 'utf8'));
        const record = JSON.parse(await readFile(join(cache, 'genome.json'), 'utf8'));
        assert.deepEqual(record.reference, reference);
        const kinds = role === 'reference' ? ['fasta', 'gff3'] : ['fasta'];
        assert.deepEqual(Object.keys(checksums).sort(), [...kinds].sort());
        for (const kind of kinds) {
          const content = await readFile(`${destination}.${kind}`, 'utf8');
          const provenance = JSON.parse(await readFile(`${destination}.${kind}.json`, 'utf8'));
          assert.equal(digest(content), checksums[kind]);
          assert.equal(provenance.checksum.value, checksums[kind]);
          assert.equal(provenance.downloaded, true);
          assert.equal(provenance.origin, 'imported');
          assert.equal(provenance.source, source);
          assert.deepEqual(provenance.parameters, reference.parameters);
          assert.deepEqual(provenance.provider_facts, {fixture: source, release: 'pinned'});
          assert.ok(provenance.resolver.node_version);
        }
        const after = await calls();
        const reused = await run(source, role, reference.id, root, `${name}-reuse`);
        assert.equal(await calls(), after);
        const provenance = JSON.parse(await readFile(`${reused.destination}.fasta.json`, 'utf8'));
        assert.equal(provenance.downloaded, false);
        assert.equal(provenance.origin, 'imported');
        assert.deepEqual(await readdir(join(root, `${source}-files`)), [reference.id]);
      }
    });
  }

  await context.test('failed cache-miss transfer leaves no published entry or consumer output', async () => {
    const root = join(temporary, 'failed');
    await assert.rejects(run('synthetic-a', 'backbone', 'transfer-failed', root, 'failed'), /Synthetic transfer failure/);
    assert.deepEqual(await readdir(join(root, 'synthetic-a-files')), []);
    await assert.rejects(readFile(join(temporary, 'failed.fasta')), {code: 'ENOENT'});
    await assert.rejects(readFile(join(temporary, 'failed.fasta.json')), {code: 'ENOENT'});
  });

  await context.test('unavailable required annotation fails consumption but retains a verified FASTA', async () => {
    const root = join(temporary, 'missing');
    await assert.rejects(run('synthetic-b', 'reference', 'missing-annotation', root, 'missing'), /requires gff3, which is unavailable/);
    for (const file of ['missing.fasta', 'missing.gff3', 'missing.fasta.json', 'missing.gff3.json']) {
      await assert.rejects(readFile(join(temporary, file)), {code: 'ENOENT'});
    }
    const after = await calls();
    const reused = await run('synthetic-b', 'target', 'missing-annotation', root, 'sequence-only');
    assert.equal(await calls(), after);
    const provenance = JSON.parse(await readFile(`${reused.destination}.fasta.json`, 'utf8'));
    assert.equal(provenance.downloaded, false);
    assert.deepEqual(await readdir(join(root, 'synthetic-b-files')), ['missing-annotation']);
  });
});
