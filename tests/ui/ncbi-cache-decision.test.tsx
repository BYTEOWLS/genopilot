import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {NcbiCacheDecisionPage, type NcbiCacheModes} from '../../src/ui/new-run-screen/ncbi-cache-decision.js';

const ENTER = '\r';
const ESCAPE = '\x1b';
const SPACE = ' ';
const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';

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
  readonly rows = 30;
  readonly columns = 100;
  readonly isTTY = false;

  override _write(_chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    callback();
  }
}

function renderPage(context: TestContext) {
  const input = new TestInput();
  const continued: NcbiCacheModes[] = [];
  let backs = 0;
  const instance = render(
    <NcbiCacheDecisionPage
      entries={[{id: 'reference', label: 'Reference GCF_000001.1'}, {id: 'target', label: 'Target GCF_000002.1'}]}
      inputActive
      onBack={() => {
        backs += 1;
      }}
      onContinue={modes => continued.push(modes)}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: new TestOutput() as unknown as NodeJS.WriteStream,
    },
  );
  context.after(() => instance.unmount());
  return {input, continued, backs: () => backs};
}

async function press(input: TestInput, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    input.write(key);
    await new Promise<void>(resolve => setTimeout(resolve, 30));
  }
}

test('starts every entry at reuse and continues only from the button', async context => {
  const {input, continued} = renderPage(context);
  await press(input, ENTER);
  assert.deepEqual(continued, []);

  await press(input, TAB, TAB, ENTER);
  assert.deepEqual(continued, [{reference: 'reuse', target: 'reuse'}]);
});

test('arrow keys on an entry choose its option, like a choice field on the form', async context => {
  const {input, continued} = renderPage(context);
  await press(input, ARROW_DOWN);
  await press(input, TAB, ARROW_UP);
  await press(input, TAB, ENTER);
  assert.deepEqual(continued, [{reference: 'refresh', target: 'refresh'}]);
});

test('space toggles and a second arrow press returns to reuse', async context => {
  const {input, continued} = renderPage(context);
  await press(input, SPACE, TAB, ARROW_DOWN, ARROW_DOWN, TAB, ENTER);
  assert.deepEqual(continued, [{reference: 'refresh', target: 'reuse'}]);
});

test('arrow keys on the continue button move back to the entries', async context => {
  const {input, continued} = renderPage(context);
  await press(input, SHIFT_TAB, ARROW_UP, ARROW_DOWN, TAB, ENTER);
  assert.deepEqual(continued, [{reference: 'reuse', target: 'refresh'}]);
});

test('escape goes back without continuing', async context => {
  const {input, continued, backs} = renderPage(context);
  await press(input, ESCAPE);
  assert.equal(backs(), 1);
  assert.deepEqual(continued, []);
});
