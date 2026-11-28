// Installs the packed tarball into a clean temporary prefix with npm and checks that the
// bundled CLI starts there with nothing but the package itself. Run after `pnpm pack:local`.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const tarball = resolve(process.argv[2] ?? 'byteowls-genopilot-local.tgz');
const tempDir = mkdtempSync(join(tmpdir(), 'genopilot-package-'));
const problems = [];

function run(command, arguments_) {
  return spawnSync(command, arguments_, {encoding: 'utf8', env: {...process.env, npm_config_update_notifier: 'false'}});
}

try {
  const install = run('npm', ['install', '--global', '--prefix', tempDir, '--no-audit', '--no-fund', tarball]);
  if (install.status !== 0) {
    throw new Error(`npm install failed:\n${install.stdout}${install.stderr}`);
  }
  const installed = join(tempDir, 'lib', 'node_modules', '@byteowls', 'genopilot');
  if (existsSync(join(installed, 'node_modules'))) {
    problems.push('the installed package has its own node_modules');
  }
  for (const path of [
    'dist/cli.js',
    'dist/gff3-replace-worker.js',
    'dist/genome-source.js',
    'workflows/shared/scripts/genome_source.py',
    'dist/THIRD-PARTY-LICENSES.md',
    'dist/browser/assets/index.html',
    'dist/browser/assets/page.js',
    'dist/browser/assets/page.css',
    'dist/browser/assets/igv.js',
    'workflows/shared/logging',
    'docs',
    'runtime/pixi.lock',
  ]) {
    if (!existsSync(join(installed, path))) {
      problems.push(`${path} is missing`);
    }
  }
  // Exercise the installed Node/Python copy boundary from an unrelated working directory.
  const unrelated = join(tempDir, 'unrelated');
  const root = join(tempDir, 'source-root');
  const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
  const cache = join(root, 'ncbi-accessions-cache', reference.id);
  mkdirSync(cache, {recursive: true});
  mkdirSync(unrelated);
  const fasta = '>synthetic-redistributable\nACGTNNNN\n';
  const digest = createHash('sha256').update(fasta).digest('hex');
  writeFileSync(join(cache, 'genomic.fna'), fasta);
  writeFileSync(join(cache, 'checksums.json'), JSON.stringify({fasta: digest}));
  writeFileSync(join(cache, 'genome.json'), JSON.stringify({reference, metadata: null, facts: {source: 'ncbi', api: 'datasets-v2-rest'}, annotation: 'not-requested'}));
  const request = {reference, kinds: ['fasta'], root: join(tempDir, 'other-root'), mode: 'reuse', copy: {path: cache, fasta_sha256: digest}};
  const python = run('python3', ['-c', 'import sys; print(sys.executable)']);
  if (python.status !== 0 || !python.stdout.trim()) {
    throw new Error(`Python is required for installed-package verification:\n${python.stderr}`);
  }
  // Managed rule jobs receive an explicit Node path, not the caller's PATH.
  const copyTest = spawnSync(python.stdout.trim(), [fileURLToPath(new URL('./verify-package-genome-source.py', import.meta.url)), join(installed, 'workflows', 'shared', 'scripts'), JSON.stringify(request), unrelated, join(installed, 'dist', 'genome-source.js')], {
    cwd: unrelated, encoding: 'utf8', env: {...process.env, HOME: tempDir, PATH: '', GENOPILOT_NODE_EXECUTABLE: process.execPath},
  });
  if (copyTest.status !== 0) {
    problems.push(`installed genome consumer failed:\n${copyTest.stdout}${copyTest.stderr}`);
  }
  const abandoned = spawnSync(process.execPath, [join(installed, 'dist', 'genome-source.js')], {
    cwd: unrelated, input: `${JSON.stringify(request)}\n`, encoding: 'utf8', env: {...process.env, HOME: tempDir},
  });
  if (abandoned.status === 0 || existsSync(join(cache, '..', `.${reference.id}.lock`))) {
    problems.push('an unacknowledged genome consumer succeeded or left its lease behind');
  }
  // A misused subcommand loads the whole bundle and package.json, then exits with usage code 2
  // without opening the interactive application.
  const start = run(join(tempDir, 'bin', 'genopilot'), ['update', 'unexpected-argument']);
  if (start.status !== 2) {
    problems.push(`the installed CLI did not start (exit ${String(start.status)}):\n${start.stderr}`);
  }
} finally {
  rmSync(tempDir, {recursive: true, force: true});
}

if (problems.length > 0) {
  console.error(`The packed package is not installable as published:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Verified a clean installation of ${tarball}.`);
