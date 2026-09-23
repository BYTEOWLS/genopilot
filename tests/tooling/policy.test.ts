import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('pins Pixi, Snakemake, Conda, and managed installation locations', () => {
  assert.equal(toolingPolicy.pixi.managedVersion, '0.79.0');
  assert.equal(
    toolingPolicy.snakemake.package,
    `snakemake=${toolingPolicy.snakemake.managedVersion}`,
  );
  assert.equal(toolingPolicy.conda.package, `conda=${toolingPolicy.conda.managedVersion}`);
  assert.equal(toolingPolicy.managedGlobalEnvironment.name, 'byteowls-genopilot');
  assert.deepEqual(toolingPolicy.managedGlobalEnvironment.channels, [
    'conda-forge',
    'bioconda',
  ]);
  assert.deepEqual(toolingPolicy.managedGlobalEnvironment.packages, [
    toolingPolicy.snakemake.package,
    toolingPolicy.conda.package,
  ]);
  assert.match(toolingPolicy.pixi.relativeExecutablePath, /^runtimes\/pixi\//);
  assert.ok(
    toolingPolicy.managedGlobalEnvironment.relativeSnakemakeExecutablePath.startsWith(
      `${toolingPolicy.managedGlobalEnvironment.relativeHomePath}/bin/`,
    ),
  );
  assert.ok(
    toolingPolicy.managedGlobalEnvironment.relativeCondaExecutablePath.startsWith(
      `${toolingPolicy.managedGlobalEnvironment.relativeHomePath}/bin/`,
    ),
  );
});

test('records versions tested with separately from supported ranges', () => {
  assert.deepEqual(toolingPolicy.node.versionsTestedWith, ['24.19.0']);
  assert.deepEqual(toolingPolicy.pixi.versionsTestedWith, []);
  assert.deepEqual(toolingPolicy.conda.versionsTestedWith, []);
  assert.deepEqual(toolingPolicy.snakemake.versionsTestedWith, []);
});

test('uses bounded compatibility ranges for all managed tools', () => {
  for (const tool of [
    toolingPolicy.pixi,
    toolingPolicy.conda,
    toolingPolicy.snakemake,
  ]) {
    assert.match(tool.minimumVersion, /^\d+\.\d+\.\d+$/);
    assert.match(tool.maximumVersionExclusive, /^\d+\.\d+\.\d+$/);
  }
});
