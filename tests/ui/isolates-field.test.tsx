import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test, {type TestContext} from 'node:test';
import React, {useState} from 'react';
import {render} from 'ink';
import {testReadSet} from '../read-sets.js';
import type {Isolate} from '../../src/isolates/catalog.js';
import {
  isolateSelectionHint,
  IsolatesField,
  parseIsolateSelection,
  useIsolateChoices,
  type IsolateCatalogReader,
  type ReadSetCompatibility,
} from '../../src/ui/components/isolates-field.js';

const ENTER = '\r';
const ESCAPE = '\x1b';
const SPACE = ' ';
const BACKSPACE = '\x7f';
const ARROW_DOWN = '\x1b[B';
const CTRL_A = '\x01';

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
    read_sets: [testReadSet(trimmed.map((flag, index) => ({r1: `/reads/${id}_${String(index)}_R1.fq`, r2: `/reads/${id}_${String(index)}_R2.fq`, trimmed: flag})))],
  };
}

const catalog = [isolate('wild-type', 'Wild type'), isolate('mutant-one', 'Mutant one', [false, true]), isolate('mutant-two', 'Mutant two')];

// Resolve fixture data by stable ID without requiring internal IDs in the presentation.
function rowFor(frame: string, id: string): string | undefined {
  const name = catalog.find(isolate => isolate.id === id)?.name;
  return name === undefined ? undefined : frame.split('\n').find(line => line.includes(name));
}

function isChosen(frame: string, id: string): boolean {
  return rowFor(frame, id)?.includes('[✔]') ?? false;
}

function Harness({
  loadIsolates,
  initialValue = '',
  onValue,
  compatibility,
}: {
  compatibility?: ReadSetCompatibility;
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
      compatibility={compatibility}
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

function renderField(context: TestContext, options: {loadIsolates?: IsolateCatalogReader; initialValue?: string; compatibility?: ReadSetCompatibility; columns?: number; rows?: number} = {}) {
  const input = new TestInput();
  const output = new TestOutput();
  output.columns = options.columns ?? output.columns;
  output.rows = options.rows ?? output.rows;
  const values: string[] = [];
  const instance = render(
    <Harness
      compatibility={options.compatibility}
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
  assert.deepEqual(parseIsolateSelection(values[0] ?? ''), ['mutant-two/reads', 'wild-type/reads']);
  await waitForFrame(output, next => next.includes('2 selected'));
});

test('keeps the previous selection when the picker is cancelled, and toggles an isolate off', async context => {
  const {input, output, values} = renderField(context, {initialValue: 'wild-type/reads,mutant-one/reads'});
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
  assert.deepEqual(parseIsolateSelection(values[0] ?? ''), ['mutant-one/reads']);
});

test('selects every isolate matching the search, all without one, and deselects them again', async context => {
  const {input, output, values} = renderField(context, {initialValue: 'wild-type/reads'});
  await waitForFrame(output, frame => frame.includes('1 selected'));
  await press(input, ENTER);
  await waitForFrame(output, frame => isChosen(frame, 'wild-type'));

  for (const key of 'mutant') {
    await press(input, key);
  }
  await waitForFrame(output, frame => rowFor(frame, 'wild-type') === undefined);
  await press(input, CTRL_A);
  await waitForFrame(output, frame => isChosen(frame, 'mutant-one') && isChosen(frame, 'mutant-two'));
  await press(input, CTRL_A);
  await waitForFrame(output, frame => !isChosen(frame, 'mutant-one') && !isChosen(frame, 'mutant-two'));

  for (let index = 0; index < 'mutant'.length; index += 1) {
    await press(input, BACKSPACE);
  }
  await waitForFrame(output, frame => rowFor(frame, 'wild-type') !== undefined);
  await press(input, CTRL_A);
  await waitForFrame(output, frame => catalog.every(isolate => isChosen(frame, isolate.id)));
  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'the selection is confirmed');
  assert.deepEqual(parseIsolateSelection(values[0] ?? ''), ['wild-type/reads', 'mutant-one/reads', 'mutant-two/reads']);
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
  const stale = isolateSelectionHint(['gone', 'wild-type/reads'], {state: 'ready', isolates: catalog});
  assert.ok(stale.text.includes('gone'));
  assert.ok(!stale.text.includes('wild-type'));

  const withStale = renderField(context, {initialValue: 'gone,wild-type/reads'});
  await waitForFrame(withStale.output, next => next.includes('gone'));
  await press(withStale.input, ENTER);
  await waitForFrame(withStale.output, next => isChosen(next, 'wild-type'));
  await press(withStale.input, ENTER);
  await waitUntil(() => withStale.values.length === 1, 'the selection is confirmed');
  assert.deepEqual(parseIsolateSelection(withStale.values[0] ?? ''), ['wild-type/reads']);
});

test('shows incompatible sets but excludes them from individual and bulk selection', async context => {
  const {input, output, values} = renderField(context, {compatibility: set => set.read_pairs.some(pair => pair.trimmed) ? ['review-required'] : []});
  await waitForFrame(output, frame => frame.includes('3 cataloged'));
  await press(input, ENTER);
  await waitForFrame(output, frame => rowFor(frame, 'mutant-one') !== undefined);
  await press(input, ARROW_DOWN);
  await waitForFrame(output, frame => frame.includes('review-required'));
  await press(input, SPACE);
  await press(input, CTRL_A);
  await waitForFrame(output, frame => isChosen(frame, 'wild-type') && isChosen(frame, 'mutant-two'));
  assert.ok(!isChosen(output.lastFrame(), 'mutant-one'));
  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'compatible sets confirmed');
  assert.deepEqual(parseIsolateSelection(values[0]!), ['wild-type/reads', 'mutant-two/reads']);
});

test('keeps highlighted incompatibility details readable with long identities and after resizing', async context => {
  const reason = `review-marker-start ${'metadata '.repeat(10)}review-marker-end`;
  const entries = Array.from({length: 12}, (_, index) => isolate(`sample-${index}`, `Delivery ${index} ${'long-name'.repeat(8)}`));
  entries[0]!.read_sets[0]!.id = 'reads-9b27a6f0-8823-4f70-98bd-94ca5b13273c';
  entries[0]!.read_sets[0]!.library_id = 'needs-review';
  const {input, output, values} = renderField(context, {
    columns: 80, rows: 24, loadIsolates: async () => entries,
    compatibility: set => set.library_id === 'needs-review' ? [reason] : [],
  });
  await waitForFrame(output, frame => frame.includes('12 cataloged'));
  await press(input, ENTER);
  const details = (frame: string) => frame.includes('review-marker-start') && frame.includes('review-marker-end');
  let frame = await waitForFrame(output, details);
  const frameFits = (next: string) => stripVTControlCharacters(next).trimEnd().split('\n').length <= output.rows;
  const fits = () => assert.ok(frameFits(output.lastFrame()), output.lastFrame());
  assert.ok(!frame.split('\n').find(line => line.startsWith('›'))?.includes('review-marker-start'));
  fits();
  output.columns = 60;
  output.rows = 20;
  output.emit('resize');
  frame = await waitForFrame(output, next => details(next) && next !== frame && frameFits(next));
  fits();
  await press(input, SPACE);
  await press(input, ARROW_DOWN);
  await waitForFrame(output, next => !next.includes('review-marker-start'));
  await press(input, SPACE);
  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'only the compatible set is confirmed');
  assert.deepEqual(parseIsolateSelection(values[0]!), ['sample-1/reads']);
});

test('uses compact names without UUIDs while keeping equally named sets separately selectable', async context => {
  const sample = isolate('sample-a', 'Sample A');
  sample.read_sets = ['Sample A', 'sample a', 'Top-up'].map((name, index) => testReadSet([
    {r1: `/reads/${index}-1.fq`, r2: `/reads/${index}-2.fq`, trimmed: false},
  ], {id: `reads-9b27a6f0-8823-4f70-98bd-94ca5b13273${index}`, name}));
  const {input, output, values} = renderField(context, {loadIsolates: async () => [sample]});
  await waitForFrame(output, frame => frame.includes('3 cataloged'));
  await press(input, ENTER);
  const frame = await waitForFrame(output, next => next.includes('Top-up'));
  assert.ok(frame.includes(`${sample.name} / Top-up`));
  assert.ok(!frame.includes(`${sample.name} / ${sample.name}`));
  assert.equal(frame.split(sample.name).length - 1, 3);
  for (const set of sample.read_sets) {
    assert.ok(!frame.includes(set.id));
  }
  await press(input, SPACE);
  await press(input, ARROW_DOWN);
  await press(input, SPACE);
  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'distinct stable IDs confirmed');
  assert.deepEqual(parseIsolateSelection(values[0]!), sample.read_sets.slice(0, 2).map(set => `${sample.id}/${set.id}`));
});

test('disambiguates different isolates with the same display name without exposing read-set IDs', async context => {
  const entries = [isolate('left', 'Same name'), isolate('right', 'Same name')];
  entries.forEach(entry => {entry.read_sets[0]!.name = entry.name;});
  const {input, output, values} = renderField(context, {loadIsolates: async () => entries});
  await waitForFrame(output, frame => frame.includes('2 cataloged'));
  await press(input, ENTER);
  await waitForFrame(output, frame => entries.every(entry => frame.includes(`(${entry.id})`)));
  await press(input, ARROW_DOWN);
  await press(input, SPACE);
  await press(input, ENTER);
  await waitUntil(() => values.length === 1, 'the distinct isolate is selected');
  assert.deepEqual(parseIsolateSelection(values[0]!), ['right/reads']);
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
