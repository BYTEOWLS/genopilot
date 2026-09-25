import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {ApiKeyTab} from '../../src/ui/accessions-screen/api-key-tab.js';

// Behavior is observed through the injected callbacks, test data, and the page structure (the
// selection marker, the button brackets, the mask character), never the tab's wording.

const ENTER = '\r';
const ARROW_DOWN = '\x1b[B';
const CTRL_U = '\x15';
const CTRL_X = '\x18';
const keyPath = '/test/secrets/test-key-file';

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
  readonly columns = 200;
  readonly rows = 30;
  readonly isTTY = false;
  private output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  read(): string {
    return this.output;
  }
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

async function press(input: TestInput, key: string): Promise<void> {
  input.write(key);
  await new Promise<void>(resolve => setTimeout(resolve, 30));
}

/** ↓ moves from the key field to the save button; Enter there saves. */
async function submit(input: TestInput): Promise<void> {
  await press(input, ARROW_DOWN);
  await press(input, ENTER);
}

function renderTab(
  context: TestContext,
  options: {
    checkConfigured?: () => Promise<boolean>;
    saveKey?: (key: string) => Promise<void>;
    clearKey?: () => Promise<void>;
  } = {},
) {
  const input = new TestInput();
  const output = new TestOutput();
  const saved: string[] = [];
  let checks = 0;
  let clears = 0;
  const instance = render(
    <ApiKeyTab
      page={{title: 'Test page'}}
      inputActive
      checkConfigured={async () => {
        checks += 1;
        return options.checkConfigured ? options.checkConfigured() : false;
      }}
      saveKey={async key => {
        saved.push(key);
        await options.saveKey?.(key);
      }}
      clearKey={async () => {
        clears += 1;
        await options.clearKey?.();
      }}
      keyPath={keyPath}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  context.after(() => instance.unmount());
  return {
    input,
    output,
    saved,
    get checks() {
      return checks;
    },
    get clears() {
      return clears;
    },
  };
}

async function ready(tab: ReturnType<typeof renderTab>): Promise<void> {
  await waitFor(() => tab.checks === 1, 'the key status check');
  await new Promise<void>(resolve => setTimeout(resolve, 30));
}

test('checks the key status and shows where the key is stored', async context => {
  const tab = renderTab(context);
  await ready(tab);

  assert.ok(tab.output.read().includes(keyPath));
});

test('shows a failed status check', async context => {
  const tab = renderTab(context, {
    checkConfigured: async () => {
      throw new Error('test status failure');
    },
  });
  await ready(tab);

  await waitFor(() => tab.output.read().includes('test status failure'), 'the failure to be shown');
});

test('masks the typed key, saves it from the button, and checks the status again', async context => {
  const tab = renderTab(context);
  await ready(tab);

  await press(tab.input, 'secret123');
  await waitFor(() => tab.output.read().includes('*********'), 'the masked draft');
  await submit(tab.input);

  await waitFor(() => tab.saved.length === 1, 'the key to be saved');
  assert.deepEqual(tab.saved, ['secret123']);
  await waitFor(() => tab.checks === 2, 'the status to be checked again');
  assert.ok(!tab.output.read().includes('secret123'));
});

test('ignores Enter in the key field and saves only from the button', async context => {
  const tab = renderTab(context);
  await ready(tab);

  await press(tab.input, 'abc');
  await press(tab.input, ENTER);
  assert.deepEqual(tab.saved, []);
  assert.doesNotMatch(tab.output.read(), /^› \[/m);

  await submit(tab.input);
  await waitFor(() => tab.saved.length === 1, 'the key to be saved');
});

test('trims pasted whitespace and control characters before saving', async context => {
  const tab = renderTab(context);
  await ready(tab);

  // One write of several characters is what Ink delivers for a paste.
  await press(tab.input, '  abc123\n ');
  await submit(tab.input);

  await waitFor(() => tab.saved.length === 1, 'the key to be saved');
  assert.deepEqual(tab.saved, ['abc123']);
});

test('does not save an empty key', async context => {
  const tab = renderTab(context);
  await ready(tab);

  await submit(tab.input);

  assert.deepEqual(tab.saved, []);
});

test('clears the draft with Ctrl+U so nothing is saved', async context => {
  const tab = renderTab(context);
  await ready(tab);

  await press(tab.input, 'abc');
  await press(tab.input, CTRL_U);
  await submit(tab.input);

  assert.deepEqual(tab.saved, []);
});

test('clears the stored key with Ctrl+X and checks the status again', async context => {
  const tab = renderTab(context);
  await ready(tab);

  await press(tab.input, CTRL_X);

  await waitFor(() => tab.clears === 1, 'the stored key to be cleared');
  await waitFor(() => tab.checks === 2, 'the status to be checked again');
});

test('keeps the draft after a failed save so it can be saved again', async context => {
  let failures = 1;
  const tab = renderTab(context, {
    saveKey: async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('test save failure');
      }
    },
  });
  await ready(tab);

  await press(tab.input, 'abc');
  await submit(tab.input);
  await waitFor(() => tab.output.read().includes('test save failure'), 'the failure to be shown');

  // The button stays selected, so Enter tries again with the same draft.
  await press(tab.input, ENTER);
  await waitFor(() => tab.saved.length === 2, 'the second attempt');
  assert.deepEqual(tab.saved, ['abc', 'abc']);
});

test('moves between the key field and the button with the arrow keys', async context => {
  const tab = renderTab(context);
  await ready(tab);

  await press(tab.input, 'abc');
  await press(tab.input, ARROW_DOWN);
  await waitFor(() => /^› \[/m.test(tab.output.read()), 'the button to be selected');
  await press(tab.input, ENTER);

  await waitFor(() => tab.saved.length === 1, 'the key to be saved');
});
