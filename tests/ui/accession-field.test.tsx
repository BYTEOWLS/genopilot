import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React, {useState} from 'react';
import {render} from 'ink';
import type {AccessionEntry} from '../../src/accessions/catalog.js';
import type {AccessionCatalogReader} from '../../src/accessions/store.js';
import {accessionHint, AccessionField} from '../../src/ui/components/accession-field.js';

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
  readonly columns = 160;
  readonly rows = 30;
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

function entry(accession: string, name: string, overrides: Partial<AccessionEntry> = {}): AccessionEntry {
  return {
    accession,
    name,
    ncbi: {
      organism: 'Synthetic organism',
      retrieved_at: '2026-01-01T00:00:00.000Z',
      source: 'datasets-v2-rest',
    },
    cached_copies: [],
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

// Renders the field and waits until its catalog load has settled and the frame shows it.
async function renderField(
  context: TestContext,
  props: {initialValue?: string; loadAccessions?: AccessionCatalogReader} = {},
): Promise<{input: TestInput; output: TestOutput; changes: string[]}> {
  const input = new TestInput();
  const output = new TestOutput();
  const changes: string[] = [];
  const load = props.loadAccessions ?? catalog;
  let settled = false;
  const loadAccessions: AccessionCatalogReader = () => load().finally(() => {
    settled = true;
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
  const timeoutAt = Date.now() + 1000;
  while (!settled && Date.now() < timeoutAt) {
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.ok(settled, 'The catalog load did not settle.');
  // The frame after the load, which renders once the settled state is committed.
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  return {input, output, changes};
}

const pickerOpen = (frame: string): boolean => frame.includes('first-assembly') && frame.includes('second-assembly');
const selectedLine = (frame: string): string => frame.split('\n').find(line => line.startsWith('›')) ?? '';

test('chooses an accession from the catalog with Enter', async context => {
  const {input, output, changes} = await renderField(context);
  await waitForFrame(output, frame => selectedLine(frame).length > 0);

  input.write(ENTER);
  await waitForFrame(output, frame => pickerOpen(frame) && selectedLine(frame).includes('GCF_000000001.1'));
  input.write(ARROW_DOWN);
  await waitForFrame(output, frame => selectedLine(frame).includes('GCA_000000002.3'));
  input.write(ENTER);

  const frame = await waitForFrame(output, value => !pickerOpen(value));
  assert.deepEqual(changes, ['GCA_000000002.3']);
  // Back in the field, the chosen value is shown with what the catalog knows about it.
  assert.match(frame, /GCA_000000002\.3/);
  assert.match(frame, /second-assembly/);
});

test('preselects the current value in the picker and keeps it when cancelled', async context => {
  const {input, output, changes} = await renderField(context, {initialValue: 'GCA_000000002.3'});
  await waitForFrame(output, frame => selectedLine(frame).length > 0);

  input.write(ENTER);
  await waitForFrame(output, frame => pickerOpen(frame) && selectedLine(frame).includes('GCA_000000002.3'));
  input.write(ESCAPE);

  await waitForFrame(output, frame => !pickerOpen(frame) && frame.includes('GCA_000000002.3'));
  assert.deepEqual(changes, []);
});

test('recognizes a typed accession from the catalog regardless of case and whitespace', async context => {
  const {input, output, changes} = await renderField(context);
  await waitForFrame(output, frame => selectedLine(frame).length > 0);

  input.write(' gcf_000000001.1');
  await waitForFrame(output, frame => frame.includes('first-assembly'));
  assert.equal(changes.at(-1), ' gcf_000000001.1');
});

test('describes the typed value by its state against the catalog', async () => {
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
  assert.equal(kind('GCF_000000009.1'), 'uncataloged');
  assert.equal(kind(' gcf_000000001.1 '), 'cataloged');
  assert.equal(kind('GCF_000000003.1'), 'conflict');
  // An unchecked catalog never claims that a valid accession is missing from it.
  assert.equal(kind('GCF_000000001.1', {state: 'loading'}), 'loading');
  assert.equal(kind('GCF_000000001.1', {state: 'failed', message: 'broken'}), 'unavailable');
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

  input.write(ENTER);
  const picker = await waitForFrame(output, frame => selectedLine(frame).includes('GCF_000000003.1'));
  // The copies that disagree are listed so the researcher can find them.
  assert.match(picker, /\/first-root\/GCF_000000003\.1/);
  assert.match(picker, /\/second-root\/GCF_000000003\.1/);

  input.write(ENTER);
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  assert.deepEqual(changes, []);
  assert.ok(selectedLine(output.lastFrame()).includes('GCF_000000003.1'), 'The picker stays open.');

  // The copies are only explained for the conflicting entry; another one is chosen as usual.
  input.write(ARROW_DOWN);
  const next = await waitForFrame(output, frame => selectedLine(frame).includes('GCF_000000001.1'));
  assert.doesNotMatch(next, /first-root/);
  input.write(ENTER);
  await waitForFrame(output, frame => !frame.includes('conflicting-assembly'));
  assert.deepEqual(changes, ['GCF_000000001.1']);
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

    input.write(ENTER);
    const picker = await waitForFrame(output, frame => frame !== form && selectedLine(frame).length === 0);
    if (index === 1) {
      assert.match(picker, /catalog is broken/);
    }
    // Enter has nothing to choose; give it time to act before leaving.
    input.write(ENTER);
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    input.write(ESCAPE);
    await waitForFrame(output, frame => selectedLine(frame).length > 0);
    assert.deepEqual(changes, []);
  }
});
