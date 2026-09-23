import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdate, compareVersions, selfUpdate} from '../src/self-update.js';

function recordingOutput(): {
  info: string[];
  errors: string[];
  output: {info(message: string): void; error(message: string): void};
} {
  const info: string[] = [];
  const errors: string[] = [];
  return {
    info,
    errors,
    output: {
      info: message => info.push(message),
      error: message => errors.push(message),
    },
  };
}

test('compares stable and prerelease semantic versions', () => {
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0-alpha.1'), 1);
  assert.equal(compareVersions('0.1.0-alpha.2', '0.1.0-alpha.10'), -8);
  assert.equal(compareVersions('not-a-version', '0.1.0'), undefined);
});

test('reports whether a newer registry release is available', async () => {
  assert.deepEqual(
    await checkForUpdate('@byteowls/genopilot', '0.1.0', async () => '0.2.0'),
    {state: 'available', latestVersion: '0.2.0'},
  );
  assert.deepEqual(
    await checkForUpdate('@byteowls/genopilot', '0.2.0', async () => '0.2.0'),
    {state: 'current'},
  );
});

test('does not reinstall when the installed version is current', async () => {
  const messages = recordingOutput();
  let installCalled = false;

  const exitCode = await selfUpdate('@byteowls/genopilot', '0.1.0', {
    readLatestVersion: async () => '0.1.0',
    runCommand: async () => {
      installCalled = true;
      return 0;
    },
    output: messages.output,
  });

  assert.equal(exitCode, 0);
  assert.equal(installCalled, false);
  assert.match(messages.info.at(-1) ?? '', /already up to date/);
  assert.deepEqual(messages.errors, []);
});

test('installs the exact checked version without lifecycle scripts', async () => {
  const messages = recordingOutput();
  let invocation: {command: string; arguments_: readonly string[]} | undefined;

  const exitCode = await selfUpdate('@byteowls/genopilot', '0.1.0', {
    readLatestVersion: async () => '0.2.0',
    runCommand: async (command, arguments_) => {
      invocation = {command, arguments_};
      return 0;
    },
    output: messages.output,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(invocation, {
    command: 'npm',
    arguments_: [
      'install',
      '--global',
      '--ignore-scripts',
      '@byteowls/genopilot@0.2.0',
    ],
  });
  assert.match(messages.info.at(-1) ?? '', /Updated successfully to v0\.2\.0/);
  assert.deepEqual(messages.errors, []);
});

test('returns the package manager failure code', async () => {
  const messages = recordingOutput();
  const exitCode = await selfUpdate('@byteowls/genopilot', '0.1.0', {
    readLatestVersion: async () => '0.2.0',
    runCommand: async () => 7,
    output: messages.output,
  });

  assert.equal(exitCode, 7);
  assert.match(messages.errors[0] ?? '', /exited with code 7/);
});

test('does not downgrade when the registry latest tag is older', async () => {
  const messages = recordingOutput();
  let installCalled = false;
  const exitCode = await selfUpdate('@byteowls/genopilot', '0.2.0-alpha.1', {
    readLatestVersion: async () => '0.1.0',
    runCommand: async () => {
      installCalled = true;
      return 0;
    },
    output: messages.output,
  });

  assert.equal(exitCode, 0);
  assert.equal(installCalled, false);
});
