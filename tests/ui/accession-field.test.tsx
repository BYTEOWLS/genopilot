import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {stripVTControlCharacters} from 'node:util';
import React, {useState} from 'react';
import {render} from 'ink';
import type {AccessionEntry} from '../../src/accessions/catalog.js';
import type {AccessionCatalogReader} from '../../src/accessions/store.js';
import {genomeSelection, selectedGenome} from '../../src/accessions/selection.js';
import {accessionHint, AccessionField} from '../../src/ui/components/accession-field.js';
import {pressKey as press, waitFor, rendered} from '../wait.js';

const ENTER = '\r';
const ESCAPE = '\x1b';
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
  /** How many frames Ink has written, to wait for the next one. */
  writes = 0;

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    this.writes += 1;
    callback();
  }

  lastFrame(): string {
    return this.output.split(/\x1b\[[GH]/).at(-1) ?? '';
  }
}

async function waitForFrame(output: TestOutput, predicate: (frame: string) => boolean): Promise<string> {
  await waitFor(() => predicate(output.lastFrame()), 'the expected terminal frame', () => `Last frame:\n${output.lastFrame()}`);
  return output.lastFrame();
}
function entry(accession: string, name: string, overrides: Partial<AccessionEntry> = {}): AccessionEntry {
  return {
    source: 'ncbi', id: accession, parameters: {},
    name,
    metadata: {
      organism: 'Synthetic organism',
      retrieved_at: '2026-01-01T00:00:00.000Z',
      source: 'datasets-v2-rest',
    },
    cached_copies: [{path: `/catalog/${accession}`, verified_at: '2026-01-01T00:00:00Z', fasta_sha256: 'a'.repeat(64)}],
    ...overrides,
  };
}

const catalog: AccessionCatalogReader = async () => [
  entry('GCF_000000001.1', 'first-assembly'),
  entry('GCA_000000002.3', 'second-assembly'),
];

// The form owns the value and whether the picker is open, as the configuration screen does.
function Harness({
  initialValue,
  loadAccessions,
  onChange,
}: {
  initialValue: string;
  loadAccessions: AccessionCatalogReader;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [choosing, setChoosing] = useState(false);
  return (
    <AccessionField
      label="Accession"
      selected
      inputActive
      value={value}
      onChange={next => {
        setValue(next);
        onChange(next);
      }}
      choosing={choosing}
      onChoosingChange={setChoosing}
      loadAccessions={loadAccessions}
    />
  );
}

// Renders the field and waits for the frame drawn after its catalog load settled. The loader's
// `finally` runs before the field stores the result, so any later frame shows the loaded state.
async function renderField(
  context: TestContext,
  props: {initialValue?: string; loadAccessions?: AccessionCatalogReader} = {},
): Promise<{input: TestInput; output: TestOutput; changes: string[]; instance: ReturnType<typeof render>}>  {
  const input = new TestInput();
  const output = new TestOutput();
  const changes: string[] = [];
  const load = props.loadAccessions ?? catalog;
  let writesAtSettle: number | undefined;
  const loadAccessions: AccessionCatalogReader = () => load().finally(() => {
    writesAtSettle = output.writes;
  });
  const instance = render(
    <Harness
      initialValue={props.initialValue ?? ''}
      loadAccessions={loadAccessions}
      onChange={value => changes.push(value)}
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
  await waitFor(
    () => writesAtSettle !== undefined && output.writes > writesAtSettle,
    'the loaded catalog is drawn',
  );
  return {input, output, changes, instance};
}

const pickerOpen = (frame: string): boolean => frame.includes('first-assembly') && frame.includes('second-assembly');
const selectedLine = (frame: string): string => frame.split('\n').find(line => line.startsWith('›')) ?? '';

test('chooses an accession from the catalog with Enter', async context => {
  const {input, output, changes} = await renderField(context);
  await waitForFrame(output, frame => selectedLine(frame).length > 0);

  await press(input, ENTER);
  await waitForFrame(output, frame => pickerOpen(frame) && selectedLine(frame).includes('GCF_000000001.1'));
  await press(input, ARROW_DOWN);
  await waitForFrame(output, frame => selectedLine(frame).includes('GCA_000000002.3'));
  await press(input, ENTER);

  const frame = await waitForFrame(output, value => !pickerOpen(value));
  assert.deepEqual(changes.map(selectedGenome), [{source: 'ncbi', id: 'GCA_000000002.3', parameters: {}}]);
  // Back in the field, the chosen value is shown with what the catalog knows about it.
  assert.match(frame, /GCA_000000002\.3/);
  assert.match(frame, /second-assembly/);
});

test('preselects the current value in the picker and keeps it when cancelled', async context => {
  const {input, output, changes} = await renderField(context, {initialValue: genomeSelection({source: 'ncbi', id: 'GCA_000000002.3', parameters: {}})});
  await waitForFrame(output, frame => selectedLine(frame).length > 0);

  await press(input, ENTER);
  await waitForFrame(output, frame => pickerOpen(frame) && selectedLine(frame).includes('GCA_000000002.3'));
  await press(input, ESCAPE);

  await waitForFrame(output, frame => !pickerOpen(frame) && frame.includes('GCA_000000002.3'));
  assert.deepEqual(changes, []);
});

test('chooses a non-NCBI catalog genome with its provider parameters intact', async context => {
  const reference = {source: 'veupathdb', id: 'FungiDB-71_ExampleA', parameters: {site: 'FungiDB', release: 71, organism_abbreviation: 'ExampleA'}};
  const genome: AccessionEntry = {...reference, name: 'other-provider-marker', metadata: {...reference.parameters, organism: 'synthetic-organism-marker'}, cached_copies: [{path: `/catalog/${reference.id}`, verified_at: '2026-01-01T00:00:00Z', fasta_sha256: 'a'.repeat(64)}]};
  const {input, output, changes} = await renderField(context, {loadAccessions: async () => [...await catalog(), genome]});
  await press(input, ENTER);
  await waitForFrame(output, frame => frame.includes(genome.name!));
  await press(input, ARROW_DOWN);
  await press(input, ARROW_DOWN);
  await press(input, ENTER);
  await waitForFrame(output, frame => !pickerOpen(frame) && frame.includes(reference.id));
  assert.deepEqual(changes, [genomeSelection(reference)]);
  assert.deepEqual(selectedGenome(changes[0]!), reference);
  await press(input, ENTER);
  await waitForFrame(output, frame => selectedLine(frame).includes(reference.id));
  await press(input, ESCAPE);
  assert.equal(changes.length, 1);
});

test('catalog lists page around focus and remain bounded after resizing', async context => {
  const choices = Array.from({length: 30}, (_, index) => entry(`GCF_${String(index + 1).padStart(9, '0')}.1`, `genome-marker-${index}`));
  const screen = await renderField(context, {loadAccessions: async () => choices});
  await press(screen.input, ENTER);
  await waitForFrame(screen.output, frame => frame.includes(choices[0]!.name!));
  screen.output.columns = 60;
  screen.output.rows = 18;
  screen.output.emit('resize');
  await rendered(screen.instance);
  const fits = () => stripVTControlCharacters(screen.output.lastFrame()).trimEnd().split('\n').length <= screen.output.rows;
  assert.ok(fits(), screen.output.lastFrame());
  const before = selectedLine(screen.output.lastFrame());
  await press(screen.input, '\x1b[6~');
  await waitForFrame(screen.output, frame => selectedLine(frame) !== before);
  assert.ok(fits(), screen.output.lastFrame());
  await press(screen.input, ENTER);
  assert.equal(screen.changes.length, 1);
  assert.ok(choices.some(choice => choice.id === selectedGenome(screen.changes[0]!)?.id));
});

test('genome fields ignore typed identifiers and deletion keys', async context => {
  for (const initialValue of ['', genomeSelection(entry('GCF_000000001.1', 'first-assembly'))]) {
    const {input, instance, changes} = await renderField(context, {initialValue});
    await press(input, 'GCF_000000009.1');
    await press(input, '\x7f');
    await rendered(instance);
    assert.deepEqual(changes, []);
  }
});

test('describes the selected reference by its state against the catalog', async () => {
  const entries = await catalog();
  const conflicting = entry('GCF_000000003.1', 'conflicting-assembly', {
    cached_copies: [
      {path: '/a/GCF_000000003.1', verified_at: '2026-01-01T00:00:00.000Z', fasta_sha256: 'a'.repeat(64)},
      {path: '/b/GCF_000000003.1', verified_at: '2026-01-01T00:00:00.000Z', fasta_sha256: 'b'.repeat(64)},
    ],
  });
  const ready = {state: 'ready', entries: [...entries, conflicting]} as const;
  const kind = (value: string, choices: Parameters<typeof accessionHint>[1] = ready): string =>
    accessionHint(value, choices).kind;

  assert.equal(kind(''), 'empty');
  assert.equal(kind('GCF_000000001'), 'invalid');
  const selection = (id: string): string => genomeSelection(entry(id, ''));
  assert.equal(kind('GCF_000000009.1'), 'invalid');
  assert.equal(kind(selection('GCF_000000009.1')), 'uncataloged');
  assert.equal(kind(selection('GCF_000000001.1')), 'cataloged');
  assert.equal(kind(selection('GCF_000000003.1')), 'conflict');
  assert.equal(kind(selection('GCF_000000001.1'), {state: 'ready', entries: [entry('GCF_000000001.1', '', {cached_copies: []})]}), 'not-downloaded');
  // An unchecked catalog never claims that a valid accession is missing from it.
  assert.equal(kind(selection('GCF_000000001.1'), {state: 'loading'}), 'loading');
  assert.equal(kind(selection('GCF_000000001.1'), {state: 'failed', message: 'broken'}), 'unavailable');
  // A malformed value is reported whatever the catalog's state.
  assert.equal(kind('GCF_1', {state: 'loading'}), 'invalid');
});

test('lists a conflicting accession with its copies but refuses to choose it', async context => {
  const conflicting = entry('GCF_000000003.1', 'conflicting-assembly', {
    cached_copies: [
      {path: '/first-root/GCF_000000003.1', verified_at: '2026-01-01T00:00:00.000Z', fasta_sha256: 'a'.repeat(64)},
      {path: '/second-root/GCF_000000003.1', verified_at: '2026-01-01T00:00:00.000Z', fasta_sha256: 'b'.repeat(64)},
    ],
  });
  const {input, output, changes} = await renderField(context, {
    loadAccessions: async () => [conflicting, entry('GCF_000000001.1', 'first-assembly')],
  });

  await press(input, ENTER);
  const picker = await waitForFrame(output, frame => selectedLine(frame).includes('GCF_000000003.1'));
  // The copies that disagree are listed so the researcher can find them.
  assert.match(picker, /\/first-root\/GCF_000000003\.1/);
  assert.match(picker, /\/second-root\/GCF_000000003\.1/);

  await press(input, ENTER);
  assert.deepEqual(changes, []);
  assert.ok(selectedLine(output.lastFrame()).includes('GCF_000000003.1'), 'The picker stays open.');

  // The copies are only explained for the conflicting entry; another one is chosen as usual.
  await press(input, ARROW_DOWN);
  const next = await waitForFrame(output, frame => selectedLine(frame).includes('GCF_000000001.1'));
  assert.doesNotMatch(next, /first-root/);
  await press(input, ENTER);
  await waitForFrame(output, frame => !frame.includes('conflicting-assembly'));
  assert.deepEqual(changes.map(selectedGenome), [{source: 'ncbi', id: 'GCF_000000001.1', parameters: {}}]);
});

test('conflicting copies stay unselectable with bounded diagnostics on short terminals', async context => {
  const id = 'GCF_000000003.1';
  const conflicting = entry(id, 'conflict-marker', {cached_copies: Array.from({length: 5}, (_, index) => ({
    path: `/very-long-directory-${'segment/'.repeat(8)}copy-${index}/${id}`,
    verified_at: '2026-01-01T00:00:00Z', fasta_sha256: (index ? 'a' : 'b').repeat(64),
  }))});
  const screen = await renderField(context, {loadAccessions: async () => [conflicting]});
  await press(screen.input, ENTER);
  await waitForFrame(screen.output, frame => selectedLine(frame).includes(id));
  screen.output.columns = 60;
  for (const rows of [18, 16]) {
    screen.output.rows = rows;
    screen.output.emit('resize');
    await rendered(screen.instance);
    const frame = stripVTControlCharacters(screen.output.lastFrame()).trimEnd();
    assert.ok(frame.split('\n').length <= rows, frame);
    assert.ok(selectedLine(frame).includes(id));
    await press(screen.input, ENTER);
    assert.deepEqual(screen.changes, []);
  }
});

test('metadata-only and non-genomic entries cannot be selected, including after resizing', async context => {
  const id = 'GCF_000000001.1';
  for (const cached_copies of [[], [{path: `/catalog/${id}`, verified_at: '2026-01-01T00:00:00Z', proteins_sha256: 'a'.repeat(64)}]]) {
    const screen = await renderField(context, {loadAccessions: async () => [entry(id, 'undownloaded-marker', {cached_copies})]});
    await press(screen.input, ENTER);
    await waitForFrame(screen.output, frame => selectedLine(frame).includes(id));
    screen.output.rows = 16;
    screen.output.columns = 60;
    screen.output.emit('resize');
    await rendered(screen.instance);
    assert.ok(stripVTControlCharacters(screen.output.lastFrame()).trimEnd().split('\n').length <= screen.output.rows);
    await press(screen.input, ENTER);
    assert.deepEqual(screen.changes, []);
    await press(screen.input, ESCAPE);
    await waitForFrame(screen.output, frame => !frame.includes('undownloaded-marker'));
    screen.instance.unmount();
  }
});

test('opens an empty or unreadable catalog without choosing anything', async context => {
  const loaders: AccessionCatalogReader[] = [
    async () => [],
    async () => {
      throw new Error('catalog is broken');
    },
  ];
  for (const [index, loadAccessions] of loaders.entries()) {
    const {input, output, changes} = await renderField(context, {loadAccessions});
    const form = await waitForFrame(output, frame => selectedLine(frame).length > 0);

    await press(input, ENTER);
    const picker = await waitForFrame(output, frame => frame !== form && selectedLine(frame).length === 0);
    if (index === 1) {
      assert.match(picker, /catalog is broken/);
    }
    // Enter has nothing to choose.
    await press(input, ENTER);
    assert.deepEqual(changes, []);
    await press(input, ESCAPE);
    await waitForFrame(output, frame => selectedLine(frame).length > 0);
    assert.deepEqual(changes, []);
  }
});
