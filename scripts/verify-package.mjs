// Installs the packed tarball into a clean temporary prefix with npm and checks that the
// bundled CLI starts there with nothing but the package itself. Run after `pnpm pack:local`.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

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
