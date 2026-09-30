import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {toolingPolicy} from '../../src/tooling/policy.js';
import {resolveToolingPaths} from '../../src/tooling/paths.js';
import {
  installTooling,
  ToolingInstallationError,
  type InstallerDependencies,
} from '../../src/tooling/installer.js';

async function fixture() {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-tooling-test-'));
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    homeDirectory: tempDir,
  });
  const calls: Array<{command: string; arguments_: readonly string[]; environment: NodeJS.ProcessEnv}> = [];

  const dependencies: InstallerDependencies = {
    resolvePaths: () => paths,
    now: () => new Date('2026-09-04T08:00:00.000Z'),
    randomId: () => 'test-run',
    downloadFile: async (_url, destination) => {
      await writeFile(destination, 'verified archive');
      return {sha256: toolingPolicy.pixi.downloads[0].sha256, bytes: 16};
    },
    runProcess: async (command, arguments_, environment) => {
      calls.push({command, arguments_, environment});
      if (command === '/usr/bin/tar' && arguments_[0] === '-tzf') {
        return {code: 0, stdout: 'pixi\n', stderr: ''};
      }
      if (command === '/usr/bin/tar') {
        const destination = arguments_[arguments_.indexOf('-C') + 1];
        assert.ok(destination);
        await mkdir(destination, {recursive: true});
        await writeFile(join(destination, 'pixi'), 'fake pixi');
        return {code: 0, stdout: '', stderr: ''};
      }
      if (command === paths.pixiExecutable && arguments_[0] === 'global') {
        return {code: 0, stdout: 'installed', stderr: ''};
      }
      if (command === paths.pixiExecutable) {
        return {code: 0, stdout: `pixi ${toolingPolicy.pixi.managedVersion}`, stderr: ''};
      }
      if (command === paths.condaExecutable) {
        return {code: 0, stdout: `conda ${toolingPolicy.conda.managedVersion}`, stderr: ''};
      }
      if (command === paths.pythonExecutable) {
        return {code: 0, stdout: `Python ${toolingPolicy.python.managedVersion}`, stderr: ''};
      }
      return {code: 0, stdout: toolingPolicy.snakemake.managedVersion, stderr: ''};
    },
  };

  return {tempDir, paths, calls, dependencies};
}

test('installs verified Pixi and the pinned runtime bundle', async context => {
  const {tempDir, paths, calls, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const phases: string[] = [];
  const liveLines: string[] = [];
  const originalRunProcess = dependencies.runProcess;
  dependencies.runProcess = async (command, arguments_, environment, onOutput, signal) => {
    if (arguments_[0] === 'global') {
      await onOutput?.('stdout', `${'x'.repeat(5000)}\nSolving environment\nInstalling`);
      await onOutput?.('stdout', ' packages\n');
    }
    return originalRunProcess(command, arguments_, environment, onOutput, signal);
  };

  const result = await installTooling(progress => {
    if (progress.type === 'phase') {
      phases.push(progress.phase);
    } else {
      liveLines.push(progress.text);
    }
  }, undefined, dependencies);

  assert.deepEqual(phases, ['pixi', 'verification', 'runtime', 'verification']);
  assert.ok(liveLines.some(line => line.includes('Solving environment')));
  assert.ok(liveLines.includes('Installing packages'));
  const truncatedLine = liveLines
    .flatMap(line => line.split('\n'))
    .find(line => line.endsWith('… [truncated]'));
  assert.equal(truncatedLine?.length, 4096);
  const installation = calls.find(call => call.arguments_[0] === 'global');
  assert.ok(installation);
  assert.deepEqual(installation.arguments_, [
    'global',
    'install',
    '--environment',
    'byteowls-genopilot',
    '--channel',
    'conda-forge',
    '--channel',
    'bioconda',
    'snakemake=9.27.0',
    'conda=26.7.3',
    'python=3.13.15',
  ]);
  assert.equal(installation.environment.PIXI_HOME, paths.pixiHome);
  assert.equal(installation.environment.PIXI_NO_CONFIG, '1');
  assert.equal(
    installation.environment.PATH,
    `${paths.managedBinDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`,
  );
  assert.equal(installation.environment.LD_PRELOAD, undefined);
  const tarCalls = calls.filter(call => call.command === '/usr/bin/tar');
  assert.deepEqual(tarCalls[0]?.arguments_.slice(0, 1), ['-tzf']);
  assert.deepEqual(tarCalls[1]?.arguments_.slice(-2), ['--', 'pixi']);
  assert.equal(result.paths, paths);
  assert.equal((await stat(paths.dataDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(result.logPath)).mode & 0o777, 0o600);
  assert.match(await readFile(result.logPath, 'utf8'), /completed successfully/);
});

test('stops before extraction when the Pixi checksum does not match', async context => {
  const {tempDir, calls, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  dependencies.downloadFile = async (_url, destination) => {
    await writeFile(destination, 'unverified archive');
    return {sha256: '0'.repeat(64), bytes: 18};
  };

  await assert.rejects(
    installTooling(() => undefined, undefined, dependencies),
    (error: unknown) => {
      assert.ok(error instanceof ToolingInstallationError);
      assert.match(error.message, /checksum verification failed/);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test('rejects archives containing anything other than the Pixi executable', async context => {
  const {tempDir, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const originalRunProcess = dependencies.runProcess;
  dependencies.runProcess = async (command, arguments_, environment, onOutput, signal) => {
    if (command === '/usr/bin/tar' && arguments_[0] === '-tzf') {
      return {code: 0, stdout: 'pixi\nunexpected-file\n', stderr: ''};
    }
    return originalRunProcess(command, arguments_, environment, onOutput, signal);
  };

  await assert.rejects(
    installTooling(() => undefined, undefined, dependencies),
    /archive contains unexpected entries/,
  );
});

test('refuses concurrent setup and preserves the active installation lock', async context => {
  const {tempDir, paths, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  await mkdir(paths.dataDirectory, {recursive: true});
  await writeFile(paths.installationLockPath, `${String(process.pid)}\n`);

  await assert.rejects(
    installTooling(() => undefined, undefined, dependencies),
    /Tooling setup is already running/,
  );
  assert.equal(await readFile(paths.installationLockPath, 'utf8'), `${String(process.pid)}\n`);
});

test('preserves a recent incomplete installation lock', async context => {
  const {tempDir, paths, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  await mkdir(paths.dataDirectory, {recursive: true});
  await writeFile(paths.installationLockPath, '');

  await assert.rejects(
    installTooling(() => undefined, undefined, dependencies),
    /Tooling setup is already running/,
  );
  assert.equal(await readFile(paths.installationLockPath, 'utf8'), '');
});

test('recovers a stale installation lock owned by a stopped process', async context => {
  const {tempDir, paths, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  await mkdir(paths.dataDirectory, {recursive: true});
  await writeFile(paths.installationLockPath, '99999999\n');

  const result = await installTooling(() => undefined, undefined, dependencies);

  assert.equal(result.paths.dataDirectory, paths.dataDirectory);
  await assert.rejects(readFile(paths.installationLockPath), /ENOENT/);
  assert.match(await readFile(result.logPath, 'utf8'), /Recovered a stale tooling setup lock/);
});

test('cancels setup and removes its lock and temporary directory', async context => {
  const {tempDir, paths, dependencies} = await fixture();
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  const controller = new AbortController();
  dependencies.downloadFile = async (_url, _destination, _maximumBytes, signal) => {
    controller.abort();
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    return {sha256: '', bytes: 0};
  };

  await assert.rejects(
    installTooling(() => undefined, controller.signal, dependencies),
    /Tooling setup cancelled/,
  );
  await assert.rejects(readFile(paths.installationLockPath), /ENOENT/);
});
