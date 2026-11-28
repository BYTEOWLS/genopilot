import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {artifactFiles, fileKinds, type FileKind} from '../../src/accessions/provider.js';
import {veupathdbProvider} from '../../src/accessions/provider/veupathdb/index.js';
import {resolveGenomeCache} from '../../src/accessions/cache.js';
import {resolveToolingPaths} from '../../src/tooling/paths.js';
import {providerSettings} from '../../src/tooling/provider-settings.js';

const enabled = process.env.RUN_VEUPATHDB_DOWNLOAD_INTEGRATION === '1';

test('live VEuPathDB whole-genome artifacts pass the packaged Python bridge, offline reuse, and historical resolution', {skip: !enabled}, async t => {
  assert.ok(process.env.VEUPATHDB_KEY_FILE, 'Set VEUPATHDB_KEY_FILE to a local key file; never pass the key itself.');
  assert.ok(existsSync(resolve('dist/genome-source.js')), 'Build the packaged entry point first.');
  const key = (await readFile(process.env.VEUPATHDB_KEY_FILE, 'utf8')).trim();
  const temporary = await mkdtemp(join(tmpdir(), 'genopilot-veupathdb-live-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const home = join(temporary, 'home');
  const settings = providerSettings(resolveToolingPaths({homeDirectory: home}).secretsDirectory);
  await settings.save(veupathdbProvider, 'api-key', key);
  const ctx = {signal: new AbortController().signal, secrets: {'api-key': key}, site: 'FungiDB'};
  for (const [site, query] of [['ToxoDB', 'gondii'], ['PlasmoDB', 'cynomolgi']] as const) {
    const found = await veupathdbProvider.search!(query, {...ctx, site});
    assert.ok(found.length > 0);
    assert.ok(found.every(result => result.reference.parameters.site === site));
  }
  const results = await veupathdbProvider.search!('Aspergillus nidulans', ctx);
  assert.equal(results.length, 1);
  const reference = results[0]!.reference;
  assert.equal(reference.parameters.organism_abbreviation, 'AnidulansFGSCA4');
  const bridgeDirectory = resolve('workflows/shared/scripts');
  function runPython(args: string[], payload: unknown): Promise<unknown> {
    return new Promise((resolveResult, reject) => {
      const child = spawn('python3', args, {cwd: temporary, env: {...process.env, HOME: home, GENOPILOT_NODE_EXECUTABLE: process.execPath}, stdio: ['pipe', 'pipe', 'pipe']});
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(stderr.split(key).join('[redacted]')));
        } else {
          try { resolveResult(JSON.parse(stdout)); } catch { reject(new Error('Invalid bridge response.')); }
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    });
  }
  async function bridge(kinds: readonly FileKind[], mode: 'reuse' | 'refresh') {
    const script = `import sys,json\nfrom pathlib import Path\nsys.path.insert(0, ${JSON.stringify(bridgeDirectory)})\nfrom genome_source import copy_genome\nv=json.load(sys.stdin)\nprint(json.dumps(copy_genome(v['request'], {k:Path(p) for k,p in v['destinations'].items()})))\n`;
    const payload = {request: {reference, kinds, root: temporary, mode}, destinations: Object.fromEntries(kinds.map(kind => [kind, join(temporary, 'consumed', artifactFiles[kind])]))};
    return await runPython(['-c', script], payload) as Record<string, unknown>;
  }
  const downloaded = await bridge(fileKinds, 'refresh');
  assert.equal(downloaded.downloaded, true);
  for (const kind of fileKinds) {
    assert.equal(typeof downloaded[`${kind}_sha256`], 'string');
    assert.ok((await readFile(join(temporary, 'consumed', artifactFiles[kind]))).length > 0);
  }
  const fasta = await readFile(join(temporary, 'consumed', artifactFiles.fasta), 'utf8');
  assert.equal(fasta.split('\n').filter(line => line.startsWith('>')).length, 9);
  await settings.clear(veupathdbProvider, 'api-key');
  const reused = await bridge(['fasta', 'gff3'], 'reuse');
  assert.equal(reused.downloaded, false, 'verified reuse succeeds with no stored credential');
  assert.equal(reused.fasta_sha256, downloaded.fasta_sha256);
  assert.equal(reused.proteins, undefined, 'workflow consumption returns only required artifacts');
  const snakemake = resolveToolingPaths().snakemakeExecutable;
  if (existsSync(snakemake)) {
    assert.deepEqual(await runPython([resolve('tests/workflows/shared/veupathdb_live_resolution.py')], {
      root: temporary, snakemake, reference,
      copy: {path: dirname(downloaded.fasta as string), fasta_sha256: downloaded.fasta_sha256, gff3_sha256: downloaded.gff3_sha256},
    }), ['reference', 'target', 'backbone']);
  } else {
    t.diagnostic('Direct Snakemake checks skipped: the managed pinned runtime is not installed.');
  }
  const historical = {source: 'veupathdb', id: 'FungiDB-70_AnidulansFGSCA4', parameters: {site: 'FungiDB', release: 70, organism_abbreviation: 'AnidulansFGSCA4'}};
  const older = await resolveGenomeCache({reference: historical, kinds: ['fasta', 'gff3'], root: temporary, mode: 'refresh'}, ctx);
  assert.equal(older.downloaded, true);
  assert.deepEqual(older.metadata, historical.parameters, 'current organism facts are not mislabeled as historical');
  await assert.rejects(resolveGenomeCache({reference: {...historical, id: 'FungiDB-999999_AnidulansFGSCA4', parameters: {...historical.parameters, release: 999999}}, kinds: ['fasta'], root: temporary, mode: 'refresh'}, ctx), /unavailable/);
});
