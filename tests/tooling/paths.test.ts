import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveToolingPaths, selectPixiDownload} from '../../src/tooling/paths.js';

test('resolves Linux tooling under XDG_DATA_HOME', () => {
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    environment: {XDG_DATA_HOME: '/researcher/data'},
    homeDirectory: '/home/researcher',
  });

  assert.equal(paths.dataDirectory, '/researcher/data/byteowlsGenopilot/tooling');
  assert.match(paths.pixiExecutable, /runtimes\/pixi\/0\.79\.0\/bin\/pixi$/);
  assert.equal(paths.managedBinDirectory, `${paths.pixiHome}/bin`);
  assert.equal(selectPixiDownload(paths).platform, 'linux');
  assert.match(selectPixiDownload(paths).url, /x86_64-unknown-linux-musl/);
});

test('resolves the NCBI API key path under a private secrets directory', () => {
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    environment: {XDG_DATA_HOME: '/researcher/data'},
    homeDirectory: '/home/researcher',
  });

  assert.equal(paths.secretsDirectory, `${paths.dataDirectory}/secrets`);
  assert.equal(paths.ncbiApiKeyPath, `${paths.dataDirectory}/secrets/ncbi-api-key`);
});

test('keeps the isolate catalog outside the managed tooling directory', () => {
  const paths = resolveToolingPaths({
    platform: 'darwin',
    architecture: 'arm64',
    environment: {},
    homeDirectory: '/Users/researcher',
  });

  assert.equal(paths.isolateCatalogDirectory, '/Users/researcher/.byteowlsGenopilot/isolates');
  assert.equal(paths.isolateCatalogPath, `${paths.isolateCatalogDirectory}/isolates.yaml`);
  assert.ok(!paths.isolateCatalogPath.startsWith(`${paths.dataDirectory}/`));
});

test('uses platform user-data defaults without depending on the working directory', () => {
  const linux = resolveToolingPaths({
    platform: 'linux',
    architecture: 'arm64',
    environment: {},
    homeDirectory: '/home/researcher',
  });
  const mac = resolveToolingPaths({
    platform: 'darwin',
    architecture: 'arm64',
    environment: {},
    homeDirectory: '/Users/researcher',
  });

  assert.equal(
    linux.dataDirectory,
    '/home/researcher/.local/share/byteowlsGenopilot/tooling',
  );
  assert.equal(
    mac.dataDirectory,
    '/Users/researcher/.byteowlsGenopilot/tooling',
  );
  assert.doesNotMatch(mac.condaExecutable, /\s/);
  assert.doesNotMatch(mac.snakemakeExecutable, /\s/);
  assert.match(selectPixiDownload(mac).url, /aarch64-apple-darwin/);
});

test('rejects unsupported native platforms and architectures', () => {
  assert.throws(
    () => resolveToolingPaths({platform: 'win32', architecture: 'x64'}),
    /Unsupported platform/,
  );
  assert.throws(
    () => resolveToolingPaths({platform: 'linux', architecture: 'riscv64'}),
    /Unsupported architecture/,
  );
});
