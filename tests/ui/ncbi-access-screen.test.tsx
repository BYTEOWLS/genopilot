import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {NcbiAccessScreen} from '../../src/ui/ncbi-access-screen/screen.js';

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
  columns = 200;
  readonly rows = 30;
  readonly isTTY = false;
  private output = '';

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.output += chunk.toString();
    callback();
  }

  readOutput(): string {
    return this.output;
  }

  clearOutput(): void {
    this.output = '';
  }
}

function registerCleanup(context: TestContext, instance: ReturnType<typeof render>): void {
  context.after(() => instance.unmount());
}

async function waitForOutput(
  output: TestOutput,
  predicate: (value: string) => boolean,
): Promise<string> {
  const timeoutAt = Date.now() + 1000;
  while (Date.now() < timeoutAt) {
    const value = output.readOutput();
    if (predicate(value)) {
      return value;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for terminal output. Received:\n${output.readOutput()}`);
}

function renderScreen(options: {
  configured?: boolean;
  checkConfigured?: () => Promise<boolean>;
  saveKey?: (key: string) => Promise<void>;
  clearKey?: () => Promise<void>;
  onBack?: () => void;
  keyPath?: string;
} = {}): {input: TestInput; output: TestOutput; instance: ReturnType<typeof render>} {
  const input = new TestInput();
  const output = new TestOutput();
  const instance = render(
    <NcbiAccessScreen
      onBack={options.onBack ?? (() => {})}
      inputActive
      checkConfigured={options.checkConfigured ?? (async () => options.configured ?? false)}
      saveKey={options.saveKey ?? (async () => undefined)}
      clearKey={options.clearKey ?? (async () => undefined)}
      keyPath={options.keyPath ?? '/researcher/data/secrets/ncbi-api-key'}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  return {input, output, instance};
}

test('shows whether an NCBI API key is configured', async context => {
  const {output, instance} = renderScreen({configured: true});
  registerCleanup(context, instance);

  await waitForOutput(output, value => value.includes('API key: Configured'));
});

test('shows where the key is stored, never its value', async context => {
  const {output, instance} = renderScreen({
    configured: true,
    keyPath: '/researcher/data/secrets/ncbi-api-key',
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('Saved to:'));
  assert.match(frame, /Saved to:\s+\/researcher\/data\/secrets\/ncbi-api-key/);
});

test('shows a failed status check', async context => {
  const {output, instance} = renderScreen({
    checkConfigured: async () => {
      throw new Error('permission denied');
    },
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('permission denied'));
  assert.doesNotMatch(frame, /API key: /);
});

test('masks the typed key and saves it on Enter', async context => {
  let saved: string | undefined;
  const {input, output, instance} = renderScreen({
    configured: false,
    saveKey: async key => {
      saved = key;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  output.clearOutput();
  input.write('abc123');
  await waitForOutput(output, value => value.includes('New key: ******'));
  assert.doesNotMatch(output.readOutput(), /abc123/);

  output.clearOutput();
  input.write('\r');
  await waitForOutput(output, value => value.includes('NCBI API key saved.'));
  assert.equal(saved, 'abc123');
});

test('trims whitespace from a pasted key before saving it', async context => {
  let saved: string | undefined;
  const {input, output, instance} = renderScreen({
    saveKey: async key => {
      saved = key;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  output.clearOutput();
  // A single input.write() call with more than one character is what Ink delivers for a paste.
  input.write('  abc123  ');
  await waitForOutput(output, value => /New key: \*+/.test(value));

  output.clearOutput();
  input.write('\r');
  await waitForOutput(output, value => value.includes('NCBI API key saved.'));
  assert.equal(saved, 'abc123');
});

test('strips an embedded control character from a pasted key before saving it', async context => {
  let saved: string | undefined;
  const {input, output, instance} = renderScreen({
    saveKey: async key => {
      saved = key;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  output.clearOutput();
  // A trailing newline from clipboard content is a realistic paste, delivered as one call.
  input.write('abc123\n');
  await waitForOutput(output, value => /New key: \*+/.test(value));

  output.clearOutput();
  input.write('\r');
  await waitForOutput(output, value => value.includes('NCBI API key saved.'));
  assert.equal(saved, 'abc123');
});

test('does not save an empty key on Enter', async context => {
  let saveCalls = 0;
  const {input, output, instance} = renderScreen({
    saveKey: async () => {
      saveCalls += 1;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  input.write('\r');
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  assert.equal(saveCalls, 0);
});

test('clears the draft with Ctrl+U without saving', async context => {
  let saveCalls = 0;
  const {input, output, instance} = renderScreen({
    saveKey: async () => {
      saveCalls += 1;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  input.write('abc');
  await waitForOutput(output, value => value.includes('New key: ***'));

  output.clearOutput();
  input.write('\x15');
  await waitForOutput(output, value => value.includes('Type or paste'));
  assert.equal(saveCalls, 0);
});

test('clears the stored key with Ctrl+X', async context => {
  let cleared = false;
  const {input, output, instance} = renderScreen({
    configured: true,
    clearKey: async () => {
      cleared = true;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Configured'));

  input.write('\x18');
  await waitForOutput(output, value => value.includes('NCBI API key cleared.'));
  assert.equal(cleared, true);
});

test('reports a failed save without clearing the draft', async context => {
  const {input, output, instance} = renderScreen({
    saveKey: async () => {
      throw new Error('disk full');
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  input.write('abc');
  await waitForOutput(output, value => value.includes('New key: ***'));
  output.clearOutput();
  input.write('\r');
  const frame = await waitForOutput(output, value => value.includes('Unable to save'));
  assert.match(frame, /disk full/);
  assert.match(frame, /New key: \*\*\*/);
});

test('returns with Escape', async context => {
  let backCalls = 0;
  const {input, output, instance} = renderScreen({
    onBack: () => {
      backCalls += 1;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('API key: Not set'));

  input.write('\x1b');
  const timeoutAt = Date.now() + 1000;
  while (backCalls === 0 && Date.now() < timeoutAt) {
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.equal(backCalls, 1);
});
