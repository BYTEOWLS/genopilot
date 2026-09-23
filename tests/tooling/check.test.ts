import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTooling, isVersionSupported} from '../../src/tooling/check.js';
import {resolveToolingPaths} from '../../src/tooling/paths.js';

test('accepts versions inside an inclusive-minimum and exclusive-maximum range', () => {
  assert.equal(isVersionSupported('v24.0.0', '24.0.0', '26.0.0'), true);
  assert.equal(isVersionSupported('node v25.9.3', '24.0.0', '26.0.0'), true);
  assert.equal(isVersionSupported('v26.0.0', '24.0.0', '26.0.0'), false);
  assert.equal(isVersionSupported('v23.11.1', '24.0.0', '26.0.0'), false);
});

test('extracts versions from supported tool output formats', () => {
  assert.equal(isVersionSupported('pixi 0.79.0', '0.79.0', '0.80.0'), true);
  assert.equal(isVersionSupported('conda 25.11.1', '25.1.0', '26.0.0'), true);
  assert.equal(isVersionSupported('9.26.1', '9.26.1', '10.0.0'), true);
});

test('rejects missing or unparseable versions', () => {
  assert.equal(isVersionSupported('', '24.0.0', '26.0.0'), false);
  assert.equal(isVersionSupported('development build', '24.0.0', '26.0.0'), false);
});

test('reports unrecognized managed-tool version output as a failed check', async context => {
  const root = await mkdtemp(join(tmpdir(), 'failed-managed-tool-check-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    environment: {XDG_DATA_HOME: root},
    homeDirectory: root,
  });
  await mkdir(dirname(paths.pixiExecutable), {recursive: true});
  await writeFile(paths.pixiExecutable, "#!/bin/sh\nprintf '%s\\n' 'development build'\n");
  await chmod(paths.pixiExecutable, 0o755);

  const status = await checkTooling(paths);

  assert.equal(status.state, 'setup-required');
  if (status.state !== 'setup-required') {
    return;
  }
  assert.deepEqual(status.pixi, {
    state: 'failed',
    message: 'Version output was not recognized',
  });
  assert.equal(status.conda.state, 'missing');
});

test('detects compatible executables in the managed tooling location', async context => {
  const root = await mkdtemp(join(tmpdir(), 'managed-tool-check-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    environment: {XDG_DATA_HOME: root},
    homeDirectory: root,
  });

  for (const [path, output] of [
    [paths.pixiExecutable, 'pixi 0.79.0'],
    [paths.condaExecutable, 'conda 25.11.1'],
    [paths.snakemakeExecutable, '9.26.1'],
  ]) {
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
    await chmod(path, 0o755);
  }

  const status = await checkTooling(paths);

  assert.equal(status.state, 'ready');
  if (status.state !== 'ready') {
    return;
  }
  assert.equal(status.pixi.state, 'available');
  assert.equal(status.conda.state, 'available');
  assert.equal(status.snakemake.state, 'available');
});
