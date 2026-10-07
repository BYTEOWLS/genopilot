import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {applicationRows, ToolingScreen} from '../../src/ui/tooling-screen/screen.js';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

class TestOutput extends Writable {
  readonly columns = 120;
  readonly rows = 30;
  readonly isTTY = false;
  output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

const build = {commit: '0123456789abcdef0123456789abcdef01234567', committedAt: '2026-10-07T08:30:00Z', modified: false};

test('application rows show the commit and its date only when the build knows them', () => {
  assert.deepEqual(applicationRows({version: '1.2.3'}).map(row => row.id), ['version']);
  const rows = applicationRows({version: '1.2.3', build});
  assert.deepEqual(rows.map(row => row.id), ['version', 'commit', 'committed-at']);
  assert.ok(rows.find(row => row.id === 'commit')?.value.startsWith('0123456789ab'));
  assert.notEqual(rows.find(row => row.id === 'committed-at')?.value, build.committedAt);
});

test('a build with uncommitted changes says so next to its commit', () => {
  const clean = applicationRows({version: '1.2.3', build}).find(row => row.id === 'commit')?.value;
  const modified = applicationRows({version: '1.2.3', build: {...build, modified: true}}).find(row => row.id === 'commit')?.value;
  assert.notEqual(modified, clean);
  assert.ok(modified?.startsWith('0123456789ab'));
});

test('the tooling screen shows the version and commit while the check runs', async (context: TestContext) => {
  const output = new TestOutput();
  const instance = render(
    <ToolingScreen
      metadata={{label: 'App', version: '1.2.3', build}}
      status={{state: 'checking'}}
      onCheck={() => {}}
      onBack={() => {}}
      inputActive={false}
    />,
    {stdin: new TestInput() as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false, interactive: true, patchConsole: false},
  );
  context.after(() => instance.unmount());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(output.output.includes('v1.2.3'));
  assert.ok(output.output.includes('0123456789ab'));
});
