import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveToolingPaths, selectPixiDownload} from '../../src/tooling/paths.js';

test('resolves Linux tooling and its Pixi download', () => {
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    homeDirectory: '/home/researcher',
  });

  assert.match(paths.pixiExecutable, /runtimes\/pixi\/0\.81\.0\/bin\/pixi$/);
  assert.equal(paths.managedBinDirectory, `${paths.pixiHome}/bin`);
  assert.equal(selectPixiDownload(paths).platform, 'linux');
  assert.match(selectPixiDownload(paths).url, /x86_64-unknown-linux-musl/);
});

test('resolves the NCBI API key path under a private secrets directory', () => {
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    homeDirectory: '/home/researcher',
  });

  assert.equal(paths.secretsDirectory, `${paths.dataDirectory}/secrets`);
  assert.equal(paths.ncbiApiKeyPath, `${paths.dataDirectory}/secrets/ncbi-api-key`);
});

test('keeps the isolate and accession catalogs outside the managed tooling directory', () => {
  const paths = resolveToolingPaths({
    platform: 'darwin',
    architecture: 'arm64',
    homeDirectory: '/Users/researcher',
  });

  assert.equal(paths.isolateCatalogDirectory, '/Users/researcher/.byteowlsGenopilot/isolates');
  assert.equal(paths.isolateCatalogPath, `${paths.isolateCatalogDirectory}/isolates.yaml`);
  assert.ok(!paths.isolateCatalogPath.startsWith(`${paths.dataDirectory}/`));
  assert.equal(paths.accessionCatalogDirectory, '/Users/researcher/.byteowlsGenopilot/accessions');
  assert.equal(paths.accessionCatalogPath, `${paths.accessionCatalogDirectory}/accessions.yaml`);
  assert.ok(!paths.accessionCatalogPath.startsWith(`${paths.dataDirectory}/`));
});

test('uses the same data directory on every platform without depending on the working directory', () => {
  const linux = resolveToolingPaths({
    platform: 'linux',
    architecture: 'arm64',
    homeDirectory: '/home/researcher',
  });
  const mac = resolveToolingPaths({
    platform: 'darwin',
    architecture: 'arm64',
    homeDirectory: '/Users/researcher',
  });

  assert.equal(
    linux.dataDirectory,
    '/home/researcher/.byteowlsGenopilot/tooling',
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
