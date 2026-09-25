import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {applyTextInputKey, TextInput, type TextInputState} from '../../src/ui/components/text-input.js';

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
  readonly columns = 80;
  readonly rows = 20;
  readonly isTTY = false;

  override _write(_chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }
}

/** Raw terminal sequences, as a macOS terminal sends them. */
const keys = {
  left: '\x1b[D',
  right: '\x1b[C',
  backspace: '\x7f',
  delete: '\x1b[3~',
  home: '\x1b[H',
  end: '\x1b[F',
  ctrlA: '\x01',
  ctrlE: '\x05',
  optionLeft: '\x1b[1;3D',
  optionRight: '\x1b[1;3C',
  metaB: '\x1bb',
  metaF: '\x1bf',
  optionBackspace: '\x1b\x7f',
  enter: '\r',
};

const noKey = {
  leftArrow: false,
  rightArrow: false,
  home: false,
  end: false,
  backspace: false,
  delete: false,
  ctrl: false,
  meta: false,
};

function at(value: string, cursor: number): TextInputState {
  return {value, cursor};
}

function renderInput(
  context: TestContext,
  props: {defaultValue?: string; onSubmit?: (value: string) => void},
): {input: TestInput; values: string[]} {
  const input = new TestInput();
  const values: string[] = [];
  const instance = render(
    <TextInput defaultValue={props.defaultValue} onChange={value => values.push(value)} onSubmit={props.onSubmit} />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: new TestOutput() as unknown as NodeJS.WriteStream,
    },
  );
  context.after(() => instance.unmount());
  return {input, values};
}

async function press(input: TestInput, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    input.write(chunk);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
}

test('backspace deletes before the cursor and stops at the start', () => {
  assert.deepEqual(applyTextInputKey(at('abcd', 2), '', {...noKey, backspace: true}), at('acd', 1));
  assert.deepEqual(applyTextInputKey(at('abcd', 0), '', {...noKey, backspace: true}), at('abcd', 0));
});

test('delete removes the character at the cursor', () => {
  assert.deepEqual(applyTextInputKey(at('abcd', 1), '', {...noKey, delete: true}), at('acd', 1));
  assert.deepEqual(applyTextInputKey(at('abcd', 4), '', {...noKey, delete: true}), at('abcd', 4));
});

test('moves to the line start and end', () => {
  for (const [input, key] of [
    ['', {...noKey, home: true}],
    ['a', {...noKey, ctrl: true}],
    ['', {...noKey, leftArrow: true, super: true}],
  ] as const) {
    assert.deepEqual(applyTextInputKey(at('abcd', 2), input, key), at('abcd', 0));
  }
  for (const [input, key] of [
    ['', {...noKey, end: true}],
    ['e', {...noKey, ctrl: true}],
    ['', {...noKey, rightArrow: true, super: true}],
  ] as const) {
    assert.deepEqual(applyTextInputKey(at('abcd', 2), input, key), at('abcd', 4));
  }
});

test('moves and deletes by word across path separators', () => {
  const path = '/data/run-7/reads';
  assert.deepEqual(applyTextInputKey(at(path, path.length), '', {...noKey, leftArrow: true, meta: true}), at(path, 12));
  assert.deepEqual(applyTextInputKey(at(path, 12), 'b', {...noKey, meta: true}), at(path, 10));
  assert.deepEqual(applyTextInputKey(at(path, 0), '', {...noKey, rightArrow: true, meta: true}), at(path, 5));
  assert.deepEqual(applyTextInputKey(at(path, 5), 'f', {...noKey, meta: true}), at(path, 9));
  assert.deepEqual(applyTextInputKey(at(path, path.length), '', {...noKey, backspace: true, meta: true}), at('/data/run-7/', 12));
});

test('inserts typed and pasted text at the cursor and ignores other shortcuts', () => {
  assert.deepEqual(applyTextInputKey(at('ad', 1), 'bc', noKey), at('abcd', 3));
  // A path pasted with its trailing newline, or with a tab, stays on one line.
  assert.deepEqual(applyTextInputKey(at('', 0), '/data/reads.fq\n', noKey), at('/data/reads.fq', 14));
  assert.deepEqual(applyTextInputKey(at('', 0), 'a\tb\r\n', noKey), at('ab', 2));
  assert.equal(applyTextInputKey(at('ad', 1), '\n', noKey), undefined);
  assert.equal(applyTextInputKey(at('ad', 1), 'u', {...noKey, ctrl: true}), undefined);
  assert.equal(applyTextInputKey(at('ad', 1), 'x', {...noKey, meta: true}), undefined);
});

test('backspacing past the start of a field keeps the rest of the value', async context => {
  const {input, values} = renderInput(context, {defaultValue: 'abcd'});

  // Put the cursor on "b", then press backspace more often than there are characters before it.
  await press(input, keys.left, keys.left, keys.left, keys.backspace, keys.backspace, keys.backspace);

  assert.deepEqual(values, ['bcd']);
});

test('understands the line and word keys macOS terminals send', async context => {
  const {input, values} = renderInput(context, {defaultValue: 'one two'});

  await press(input, keys.home, 'X', keys.end, 'Y', keys.ctrlA, keys.delete, keys.ctrlE);
  await press(input, keys.optionLeft, '-', keys.metaB, keys.metaF, keys.optionRight, keys.optionBackspace);

  assert.deepEqual(values, [
    'Xone two',
    'Xone twoY',
    'one twoY',
    'one -twoY',
    'one -',
  ]);
});

test('submits the current value on Return', async context => {
  const submitted: string[] = [];
  const {input} = renderInput(context, {defaultValue: 'key', onSubmit: value => submitted.push(value)});

  await press(input, keys.backspace, keys.enter);

  assert.deepEqual(submitted, ['ke']);
});
