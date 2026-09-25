import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React, {useState} from 'react';
import {render} from 'ink';
import type {Isolate} from '../../src/isolates/catalog.js';
import {
  isolateSelectionHint,
  IsolatesField,
  parseIsolateSelection,
  useIsolateChoices,
  type IsolateCatalogReader,
} from '../../src/ui/components/isolates-field.js';

const ENTER = '\r';
const ESCAPE = '\x1b';
const SPACE = ' ';
const BACKSPACE = '\x7f';
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
  columns = 160;
  rows = 30;
  readonly isTTY = false;
  private output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }

  lastFrame(): string {
    return this.output.split(/\x1b\[[GH]/).at(-1) ?? '';
  }
}

async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting until ${description}`);
}

async function press(input: TestInput, key: string): Promise<void> {
  input.write(key);
  await waitUntil(() => input.readableLength === 0, 'the key is handled');
}

async function waitForFrame(output: TestOutput, predicate: (frame: string) => boolean): Promise<string> {
  const timeoutAt = Date.now() + 1000;
  while (Date.now() < timeoutAt) {
    const frame = output.lastFrame();
    if (predicate(frame)) {
      return frame;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for a terminal frame. Last frame:\n${output.lastFrame()}`);
}

function isolate(id: string, name: string, trimmed: boolean[] = [false]): Isolate {
  return {
    id,
    name,
    wildtype: null,
    derived_from: null,
    read_pairs: trimmed.map((flag, index) => ({r1: `/reads/${id}_${String(index)}_R1.fq`, r2: `/reads/${id}_${String(index)}_R2.fq`, trimmed: flag})),
  };
}

const catalog = [isolate('wild-type', 'Wild type'), isolate('mutant-one', 'Mutant one', [false, true]), isolate('mutant-two', 'Mutant two')];

// The picker marks a chosen isolate with a check mark in its row, which is found by stable ID.
function rowFor(frame: string, id: string): string | undefined {
  return frame.split('\n').find(line => line.includes(`(${id})`));
}

function isChosen(frame: string, id: string): boolean {
  return rowFor(frame, id)?.includes('[✔]') ?? false;
}

function Harness({
  loadIsolates,
  initialValue = '',
  onValue,
}: {
  loadIsolates: IsolateCatalogReader;
  initialValue?: string;
  onValue: (value: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [choosing, setChoosing] = useState(false);
  // As a form does: one load, repeated whenever the picker opens.
  const [openings, setOpenings] = useState(0);
  const choices = useIsolateChoices(loadIsolates, true, openings);
  return (
    <IsolatesField
      label="Isolates"
      selected
      inputActive
      value={value}
      onChange={next => {
        setValue(next);
        onValue(next);
      }}
      choosing={choosing}
      onChoosingChange={choose => {
        if (choose) {
          setOpenings(count => count + 1);
        }
        setChoosing(choose);
      }}
      choices={choices}
    />
  );
}

function renderField(context: TestContext, options: {loadIsolates?: IsolateCatalogReader; initialValue?: string} = {}) {
  const input = new TestInput();
  const output = new TestOutput();
  const values: string[] = [];
  const instance = render(
    <Harness
      loadIsolates={options.loadIsolates ?? (async () => catalog)}
      initialValue={options.initialValue}
      onValue={value => values.push(value)}
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
  return {input, output, values};
}

test('selects several isolates, searching by name, and keeps them in selection order', async context => {
  const {input, output, values} = renderField(context);
  await waitForFrame(output, frame => frame.includes('3 cataloged'));
  await press(input, ENTER);
  await waitForFrame(output, frame => rowFor(frame, 'mutant-two') !== undefined);

  for (const key of 'two') {
    await press(input, key);
  }
  let frame = await waitForFrame(output, next => rowFor(next, 'wild-type') === undefined);
  assert.ok(rowFor(frame, 'mutant-two'));
  await press(input, SPACE);
  await waitForFrame(output, next => isChosen(next, 'mutant-two'));

  for (let index = 0; index < 3; index += 1) {
    await press(input, BACKSPACE);
  }
  await waitForFrame(output, next => rowFor(next, 'wild-type') !== undefined);
  await press(input, SPACE);
  frame = await waitForFrame(output, next => isChosen(next, 'wild-type'));
  assert.ok(isChosen(frame, 'mutant-two'));

  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'the selection is confirmed');
  assert.deepEqual(parseIsolateSelection(values[0] ?? ''), ['mutant-two', 'wild-type']);
  await waitForFrame(output, next => next.includes('2 selected'));
});

test('keeps the previous selection when the picker is cancelled, and toggles an isolate off', async context => {
  const {input, output, values} = renderField(context, {initialValue: 'wild-type,mutant-one'});
  await waitForFrame(output, frame => frame.includes('2 selected'));
  await press(input, ENTER);
  await waitForFrame(output, frame => isChosen(frame, 'wild-type') && isChosen(frame, 'mutant-one'));
  await press(input, SPACE);
  await waitForFrame(output, frame => !isChosen(frame, 'wild-type'));
  await press(input, ESCAPE);
  await waitForFrame(output, frame => frame.includes('2 selected'));
  assert.deepEqual(values, []);

  await press(input, ENTER);
  await waitForFrame(output, frame => isChosen(frame, 'wild-type'));
  await press(input, SPACE);
  await waitForFrame(output, frame => !isChosen(frame, 'wild-type'));
  await press(input, ARROW_DOWN);
  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'the selection is confirmed');
  assert.deepEqual(parseIsolateSelection(values[0] ?? ''), ['mutant-one']);
});

test('explains an empty or unreadable catalog and drops isolates that are no longer cataloged', async context => {
  const empty = renderField(context, {loadIsolates: async () => []});
  await waitForFrame(empty.output, frame => frame.includes('Manage isolates'));
  await press(empty.input, ENTER);
  const frame = await waitForFrame(empty.output, next => next.includes('No isolates cataloged yet.'));
  await press(empty.input, ENTER);
  assert.ok(empty.output.lastFrame().includes(frame.split('\n')[0] ?? ''));
  assert.deepEqual(empty.values, []);

  assert.equal(isolateSelectionHint([], {state: 'failed', message: 'broken'}).color, 'yellow');
  const stale = isolateSelectionHint(['gone', 'wild-type'], {state: 'ready', isolates: catalog});
  assert.ok(stale.text.includes('gone'));
  assert.ok(!stale.text.includes('wild-type'));

  const withStale = renderField(context, {initialValue: 'gone,wild-type'});
  await waitForFrame(withStale.output, next => next.includes('gone'));
  await press(withStale.input, ENTER);
  await waitForFrame(withStale.output, next => isChosen(next, 'wild-type'));
  await press(withStale.input, ENTER);
  await waitUntil(() => withStale.values.length === 1, 'the selection is confirmed');
  assert.deepEqual(parseIsolateSelection(withStale.values[0] ?? ''), ['wild-type']);
});

test('loads the catalog once, and again only when the picker opens', async context => {
  let loads = 0;
  let isolates = catalog.slice(0, 1);
  const {input, output} = renderField(context, {
    loadIsolates: async () => {
      loads += 1;
      return isolates;
    },
  });
  await waitForFrame(output, frame => frame.includes('1 cataloged'));
  assert.equal(loads, 1);

  isolates = catalog;
  await press(input, ENTER);
  await waitForFrame(output, frame => rowFor(frame, 'mutant-two') !== undefined);
  assert.equal(loads, 2);
  await press(input, SPACE);
  await press(input, ESCAPE);
  await waitForFrame(output, frame => frame.includes('3 cataloged'));
  assert.equal(loads, 2);
});
