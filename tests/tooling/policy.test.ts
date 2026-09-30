import {readdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'yaml';
import {toolingPolicy} from '../../src/tooling/policy.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as {engines: {node: string}};

test('keeps the package Node range aligned with the tooling policy', () => {
  const {minimumVersion, maximumVersionExclusive} = toolingPolicy.node;

  assert.equal(packageJson.engines.node, `>=${minimumVersion} <${maximumVersionExclusive}`);
});

test('defines one verified Pixi download for every supported platform', () => {
  const expectedPlatforms = new Set([
    'darwin/arm64',
    'darwin/x64',
    'linux/arm64',
    'linux/x64',
  ]);
  const actualPlatforms = new Set<string>();

  for (const download of toolingPolicy.pixi.downloads) {
    const platform = `${download.platform}/${download.architecture}`;
    assert.equal(actualPlatforms.has(platform), false, `duplicate download for ${platform}`);
    actualPlatforms.add(platform);
    assert.match(download.url, /^https:\/\//);
    assert.ok(
      download.url.includes(`/${toolingPolicy.pixi.releaseTag}/`),
      `download URL is not pinned to ${toolingPolicy.pixi.releaseTag}`,
    );
    assert.match(download.sha256, /^[a-f0-9]{64}$/);
  }

  assert.deepEqual(actualPlatforms, expectedPlatforms);
});

test('pins Pixi and keeps the managed runtime inside the data directory', () => {
  assert.equal(toolingPolicy.pixi.managedVersion, '0.81.0');
  assert.match(toolingPolicy.pixi.relativeExecutablePath, /^runtimes\/pixi\//);
  assert.equal(toolingPolicy.managedRuntime.relativeBinPath, '.pixi/envs/default/bin');
});

test('locks the packaged runtime to the versions setup verifies, on every supported platform', () => {
  const runtimeDirectory = new URL('../../runtime/', import.meta.url);
  const manifest = readFileSync(new URL('pixi.toml', runtimeDirectory), 'utf8');
  const lock = parse(readFileSync(new URL('pixi.lock', runtimeDirectory), 'utf8')) as {
    environments: {default: {packages: Record<string, Array<{conda?: string}>>}};
  };
  const packages = lock.environments.default.packages;
  assert.deepEqual(Object.keys(packages).sort(), [
    'linux-64',
    'linux-aarch64',
    'osx-64',
    'osx-arm64',
  ]);

  for (const tool of ['snakemake', 'conda', 'python'] as const) {
    const version = toolingPolicy[tool].managedVersion;
    assert.match(manifest, new RegExp(`^${tool} = "==${version.replaceAll('.', '\\.')}"$`, 'm'));
    for (const [platform, entries] of Object.entries(packages)) {
      assert.ok(
        entries.some(entry => entry.conda?.split('/').at(-1)?.startsWith(`${tool}-${version}-`)),
        `${platform} does not lock ${tool} ${version}`,
      );
    }
  }
});

test('records versions tested with separately from supported ranges', () => {
  assert.deepEqual(toolingPolicy.node.versionsTestedWith, ['24.19.0']);
  assert.deepEqual(toolingPolicy.pixi.versionsTestedWith, []);
  assert.deepEqual(toolingPolicy.conda.versionsTestedWith, []);
  assert.deepEqual(toolingPolicy.snakemake.versionsTestedWith, []);
  assert.deepEqual(toolingPolicy.python.versionsTestedWith, []);
});

test('uses bounded compatibility ranges for all managed tools', () => {
  for (const tool of [
    toolingPolicy.pixi,
    toolingPolicy.conda,
    toolingPolicy.snakemake,
    toolingPolicy.python,
  ]) {
    assert.match(tool.minimumVersion, /^\d+\.\d+\.\d+$/);
    assert.match(tool.maximumVersionExclusive, /^\d+\.\d+\.\d+$/);
  }
});

test('pins the rule environments to the Python the managed runtime runs on', () => {
  const workflowsDirectory = fileURLToPath(new URL('../../workflows/', import.meta.url));
  const environmentFiles = readdirSync(workflowsDirectory, {recursive: true})
    .map(String)
    .filter(path => path.endsWith('environment.yaml'));
  assert.ok(environmentFiles.length > 0);

  for (const path of environmentFiles) {
    const pin = readFileSync(join(workflowsDirectory, path), 'utf8').match(/^\s*-\s+python=(\S+)\s*$/m)?.[1];
    assert.equal(pin, toolingPolicy.python.managedVersion, `${path} pins python=${pin}`);
  }
});
