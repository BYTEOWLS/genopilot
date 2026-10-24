import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {IsolateForm, withIsolate} from '../../src/ui/isolates-screen/isolate-form.js';
import {validateIsolateCatalog, type Isolate} from '../../src/isolates/catalog.js';
import {testReadSet} from '../read-sets.js';
import {isolateTechnique} from '../../src/isolates/presentation.js';
import {IsolatesScreen} from '../../src/ui/isolates-screen/screen.js';
import {parseMarkdown} from '../../src/docs/markdown.js';
import {IsolateImport} from '../../src/ui/isolates-screen/import.js';
import type {DeliveryScan} from '../../src/isolates/illumina/delivery.js';

class Input extends PassThrough {
  isTTY = true;
  setRawMode() {return this;}
  ref() {return this;}
  unref() {return this;}
}
class Output extends Writable {
  columns = 160;
  rows = 40;
  output = '';
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {this.output += chunk.toString(); callback();}
  lastFrame(): string {
    return stripVTControlCharacters(this.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd();
  }
}
const pause = () => new Promise(resolve => setTimeout(resolve, 35));
const fixture = (): Isolate => ({id: 'sample-a', name: 'Sample A', wildtype: null, derived_from: null,
  read_sets: [testReadSet([{r1: '/reads/r1.fq', r2: '/reads/r2.fq', trimmed: false}])]});

test('creates multiple read sets and file groups with explicit shared library metadata', async context => {
  const input = new Input();
  const output = new Output();
  let saved: Isolate | undefined;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: []}}
    onSubmit={async value => {saved = value;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      input.write(key);
      await pause();
    }
  };
  await pause();
  await press('Archive sample', '\t', '\t', '\t', '\t', '\t');
  await press('Delivery one', '\t');
  await press(...Array<string>('archive-sample-library-1'.length).fill('\x7f'));
  await press('shared-library', '\t', ' ', '\t', '\t');
  await press('/reads/first-r1.fq', '\t', '/reads/first-r2.fq', '\t', ' ', ' ', '\t', '\r');
  // Adding a group keeps focus on its button; move back to the new group's first path.
  await press('\x1b[A', '\x1b[A', '\x1b[A', '\x1b[A');
  await press('/reads/lane2-r1.fq', '\t', '/reads/lane2-r2.fq', '\t', ' ', '\t', '\t', '\t', '\r');
  await press('Top-up', '\t');
  await press(...Array<string>('archive-sample-library-1'.length).fill('\x7f'));
  await press('shared-library', '\t', ' ', '\t', '\t');
  await press('/reads/topup-r1.fq', '\t', '/reads/topup-r2.fq', '\t', ' ', ' ', '\t', '\t', '\t', '\t', '\r');
  assert.ok(saved);
  assert.deepEqual(saved.read_sets.map(set => set.read_pairs.length), [2, 1]);
  assert.deepEqual(saved.read_sets.map(set => set.library_id), ['shared-library', 'shared-library']);
  assert.equal(new Set(saved.read_sets.map(set => set.id)).size, 2);
  assert.deepEqual(saved.read_sets[0]!.read_pairs.map(pair => pair.trimmed), [false, true]);
});

test('windows a large form around focus after navigation, resize, and validation failure', async context => {
  const input = new Input();
  const output = new Output();
  output.columns = 80;
  output.rows = 24;
  const editing = fixture();
  editing.read_sets = Array.from({length: 5}, (_, index) => testReadSet([
    {r1: `/reads/${index}-r1.fq`, r2: `/reads/${index}-r2.fq`, trimmed: false},
    {r1: `/reads/${index}-lane2-r1.fq`, r2: `/reads/${index}-lane2-r2.fq`, trimmed: true},
  ], {id: `set-${index}`, name: `Delivery ${index}`, library_id: `library-${index}`}));
  let saved = false;
  const failure = 'input-unavailable-marker';
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: [editing]}} editing={editing}
    onSubmit={async () => {saved = true;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async () => {throw new Error(Array(100).fill(failure).join('\n'));}} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const selected = () => {
    const line = output.lastFrame().split('\n').find(line => /^\s*› /.test(line)) ?? '';
    return line.slice(Math.max(0, line.indexOf('› ')));
  };
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(output.lastFrame());
  };
  const press = async (key: string) => {
    const before = selected();
    input.write(key);
    if (key === '\t') {
      await waitFor(() => selected() !== before);
    }
    await pause();
  };
  const frameFits = () => output.lastFrame().split('\n').length <= output.rows;
  const fits = () => assert.ok(frameFits(), output.lastFrame());
  await waitFor(() => selected().includes(editing.name));
  assert.ok(selected().includes(editing.name));
  fits();
  // Four isolate fields, two fourteen-row read sets, then the next set's library field.
  for (let index = 0; index < 33; index++) {
    await press('\t');
  }
  assert.ok(selected().includes('library-2'), output.lastFrame());
  assert.ok(!output.lastFrame().includes(editing.name));
  fits();
  output.rows = 14;
  output.columns = 60;
  output.emit('resize');
  await waitFor(() => selected().includes('library-2') && frameFits());
  assert.ok(selected().includes('library-2'), output.lastFrame());
  assert.ok(output.lastFrame().includes(editing.read_sets[2]!.name), 'The current read-set heading stays visible.');
  fits();
  await press('\t'); await press('\t'); await press('\t');
  assert.ok(selected().includes(editing.read_sets[2]!.read_pairs[0]!.r1), output.lastFrame());
  assert.ok(output.lastFrame().includes(editing.read_sets[2]!.name));
  fits();
  output.rows = 24;
  output.emit('resize');
  await pause();
  // Keep navigating to the save row; read-set actions now have the same button brackets.
  for (let index = 36; index < 75; index++) {
    await press('\t');
  }
  assert.ok(selected().startsWith('› ['), output.lastFrame());
  await press('\r');
  await waitFor(() => output.lastFrame().includes(failure));
  assert.ok(output.lastFrame().includes(failure), output.lastFrame());
  assert.ok(selected().startsWith('› ['));
  assert.equal(saved, false);
  fits();

  const invalid = structuredClone(editing);
  invalid.name = 'Invalid-library-sample';
  invalid.read_sets.forEach(set => {set.library_id = ''; set.name = '';});
  let checkedInvalid = false;
  app.rerender(<IsolateForm key="invalid" catalog={{schema_version: 1, isolates: [invalid]}} editing={invalid}
    onSubmit={async () => {saved = true;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async () => {checkedInvalid = true; return {pairs: [], sameFiles: []};}} />);
  await waitFor(() => selected().includes(invalid.name));
  input.write('\x1b[A');
  await waitFor(() => selected().startsWith('› ['));
  await press('\r');
  await waitFor(() => output.lastFrame().includes('•'));
  assert.equal((output.lastFrame().match(/•/g) ?? []).length, 3);
  assert.equal(checkedInvalid, false);
  assert.equal(saved, false);
  fits();
});

test('accepts a prefilled new library without changing existing saved library identities', async context => {
  const editing = fixture();
  editing.read_sets[0]!.library_id = 'sample-a-library-1';
  const input = new Input();
  const output = new Output();
  let saved: Isolate | undefined;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: [editing]}} editing={editing}
    onSubmit={async value => {saved = value;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      input.write(key);
      await pause();
    }
  };
  await pause();
  await press('\x1b[A', '\x1b[A', '\r', 'Second delivery', '\t');
  assert.ok(output.output.includes('sample-a-library-2'));
  await press('\t', ' ', '\t', '\t', '/reads/new-r1.fq', '\t', '/reads/new-r2.fq', '\t', ' ', ' ');
  await press('\t', '\t', '\t', '\t', '\r');
  assert.ok(saved);
  assert.deepEqual(saved.read_sets.map(set => set.library_id), ['sample-a-library-1', 'sample-a-library-2']);
  assert.equal(saved.read_sets[0]!.id, editing.read_sets[0]!.id);
});

test('editing offers four-colour and one-channel chemistry without guessing poly-G', async context => {
  const input = new Input();
  const output = new Output();
  const editing = fixture();
  let saved: Isolate | undefined;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: [editing]}} editing={editing}
    onSubmit={async value => {saved = value;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const press = async (key: string) => {input.write(key); await pause();};
  await pause();
  for (let index = 0; index < 6; index++) {
    await press('\t');
  }
  // From the fixture's two-colour value, traverse four-colour and one-channel.
  await press(' '); await press(' ');
  for (let index = 0; index < 7; index++) {
    await press('\x1b[A');
  }
  await press('\r');
  assert.ok(saved);
  assert.equal(saved.read_sets[0]!.illumina.chemistry, 'one-channel');
  assert.equal(saved.read_sets[0]!.illumina.poly_g, 'auto');
});

test('editing preserves stable set IDs, multiple pairs and shared library identity', async context => {
  const editing = fixture();
  editing.read_sets[0]!.read_pairs.push({r1: '/reads/lane2-r1.fq', r2: '/reads/lane2-r2.fq', trimmed: true});
  editing.read_sets.push(testReadSet([{r1: '/reads/topup-r1.fq', r2: '/reads/topup-r2.fq', trimmed: null}], {id: 'topup'}));
  const input = new Input();
  const output = new Output();
  let saved: Isolate | undefined;
  let checked = 0;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: [editing]}} editing={editing}
    onSubmit={async value => {saved = value;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async pairs => {checked = pairs.length; return {pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []};}} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await pause();
  input.write('\x1b[A'); // From the first row, wrap to the selectable save button.
  await pause();
  input.write('\r');
  await pause();
  assert.deepEqual(saved, editing);
  assert.equal(checked, 3);
  assert.deepEqual(editing, fixtureWithGroups());
});

function fixtureWithGroups(): Isolate {
  const entry = fixture();
  entry.read_sets[0]!.read_pairs.push({r1: '/reads/lane2-r1.fq', r2: '/reads/lane2-r2.fq', trimmed: true});
  entry.read_sets.push(testReadSet([{r1: '/reads/topup-r1.fq', r2: '/reads/topup-r2.fq', trimmed: null}], {id: 'topup'}));
  return entry;
}

test('Enter on text does not submit; cancellation is explicit and resize keeps the form usable', async context => {
  const input = new Input();
  const output = new Output();
  let saved = 0;
  let cancelled = 0;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: []}} editing={fixture()}
    onSubmit={async () => {saved++;}} onCancel={() => {cancelled++;}} inputActive currentDirectory="/"
    checkReads={async () => ({pairs: [], sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await pause();
  input.write('\r');
  await pause();
  assert.equal(saved, 0);
  output.columns = 60;
  output.emit('resize');
  await pause();
  input.write('\x1b');
  await pause();
  assert.equal(cancelled, 1);
});

test('missing library identity and failed file checks prevent saving', async context => {
  const input = new Input();
  const output = new Output();
  const entry = fixture();
  entry.read_sets[0]!.library_id = '';
  let saved = 0;
  let checked = 0;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: []}} editing={entry}
    onSubmit={async () => {saved++;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async () => {checked++; throw new Error('unreadable input');}} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await pause(); input.write('\x1b[A'); await pause(); input.write('\r'); await pause();
  assert.equal(saved, 0);
  assert.equal(checked, 0);
  app.rerender(<IsolateForm key="valid" catalog={{schema_version: 1, isolates: []}} editing={fixture()}
    onSubmit={async () => {saved++;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async () => {checked++; throw new Error('unreadable input');}} />);
  await pause(); input.write('\x1b[A'); await pause(); input.write('\r'); await pause();
  assert.equal(saved, 0);
  assert.equal(checked, 1);
});

test('list checks all groups and removal requires confirmation without touching read files', async context => {
  const input = new Input();
  const output = new Output();
  let catalog = {schema_version: 1 as const, isolates: [fixture()]};
  let updates = 0;
  let checked = 0;
  const app = render(<IsolatesScreen onBack={() => {}} inputActive currentDirectory="/" catalogPath="/catalog.yaml"
    loadCatalog={async () => ({catalog, revision: 'current'})}
    updateCatalog={async (_revision, mutate) => {updates++; catalog = validateIsolateCatalog(mutate(catalog)); return {catalog, revision: 'next'};}}
    checkReads={async pairs => {checked += pairs.length; return {pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []};}} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await pause();
  assert.equal(checked, 1);
  input.write('d'); await pause();
  assert.equal(updates, 0);
  input.write('\x1b'); await pause();
  assert.equal(catalog.isolates.length, 1);
  input.write('d'); await pause(); input.write('y'); await pause();
  assert.equal(updates, 1);
  assert.equal(catalog.isolates.length, 0);
});

test('lineage blocks removal and an unavailable catalog offers no mutating actions', async context => {
  const input = new Input();
  const output = new Output();
  const first = fixture();
  const child: Isolate = {...fixture(), id: 'child', derived_from: first.id,
    read_sets: [testReadSet([{r1: '/reads/child-1.fq', r2: '/reads/child-2.fq', trimmed: false}])]};
  let updates = 0;
  let back = 0;
  const app = render(<IsolatesScreen onBack={() => {back++;}} inputActive currentDirectory="/" catalogPath="/catalog.yaml"
    loadCatalog={async () => ({catalog: {schema_version: 1, isolates: [first, child]}, revision: 'current'})}
    updateCatalog={async () => {updates++; throw new Error('must not update');}}
    checkReads={async () => ({pairs: [], sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, debug: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await pause(); input.write('d'); await pause(); input.write('y'); await pause();
  assert.equal(updates, 0);
  app.rerender(<IsolatesScreen key="failed" onBack={() => {back++;}} inputActive currentDirectory="/" catalogPath="/catalog.yaml"
    loadCatalog={async () => {throw new Error('invalid catalog');}}
    updateCatalog={async () => {updates++; throw new Error('must not update');}}
    checkReads={async () => ({pairs: [], sameFiles: []})} />);
  await pause(); input.write('n'); await pause(); input.write('d'); await pause(); input.write('y'); await pause();
  input.write('\x1b'); await pause();
  assert.equal(updates, 0);
  assert.equal(back, 1);
});

test('list help preserves selection, blocks list actions, and closes safely after load failure or success', async context => {
  const input = new Input();
  const output = new Output();
  const first = fixture();
  const second = {...fixture(), id: 'second', name: 'Second sample'};
  let loads = 0;
  let updates = 0;
  let back = 0;
  const failure = 'help-load-failure-marker';
  const content = 'isolate-help-content-marker';
  const app = render(<IsolatesScreen onBack={() => {back++;}} inputActive currentDirectory="/" catalogPath="/catalog.yaml"
    loadCatalog={async () => ({catalog: {schema_version: 1, isolates: [first, second]}, revision: 'current'})}
    updateCatalog={async () => {updates++; throw new Error('must not save from help');}}
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})}
    loadHelp={async () => {
      loads++;
      if (loads === 1) {
        throw new Error(failure);
      }
      return [{id: 'isolates', title: 'Help fixture', blocks: parseMarkdown(content)}];
    }} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(output.lastFrame());
  };
  const press = async (key: string) => {input.write(key); await pause();};
  const selection = () => output.lastFrame().split('\n').find(line => line.startsWith('›')) ?? '';
  await waitFor(() => selection().includes(first.name));
  await press('\x1b[B');
  await waitFor(() => selection().includes(second.name));
  await press('?');
  await waitFor(() => output.lastFrame().includes(failure));
  await press('\x1b');
  await waitFor(() => selection().includes(second.name));
  assert.equal(back, 0);
  await press('?');
  await waitFor(() => output.lastFrame().includes(content));
  await press('n'); await press('d'); await press('y');
  assert.equal(updates, 0);
  await press('?');
  await waitFor(() => selection().includes(second.name));
  assert.equal(loads, 2);
  assert.equal(back, 0);
  // The edit form receives the same help loader and retains the list selection on return.
  await press('\r'); await press('\t'); await press('\t'); await press('?');
  await waitFor(() => loads === 3 && output.lastFrame().includes(content));
  await press('\x1b'); await press('\x1b');
  await waitFor(() => selection().includes(second.name));
  assert.equal(updates, 0);
});

test('edit help preserves the draft and focus while question marks remain editable text', async context => {
  const input = new Input();
  const output = new Output();
  const editing = fixture();
  const content = 'edit-help-content-marker';
  const techniqueContent = 'technique-help-content-marker';
  let loads = 0;
  let saved: Isolate | undefined;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: [editing]}} editing={editing}
    onSubmit={async value => {saved = value;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})}
    loadHelp={async () => {
      loads++;
      return [
        {id: 'isolates', title: 'General fixture', blocks: parseMarkdown(content)},
        {id: 'illumina', title: 'Technique fixture', blocks: parseMarkdown(techniqueContent)},
      ];
    }} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      input.write(key);
      await pause();
    }
  };
  await pause();
  await press('?', '\t', '\t');
  assert.equal(loads, 0);
  const waitForContent = async (marker: string) => {
    for (let attempt = 0; attempt < 100 && !output.lastFrame().includes(marker); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(output.lastFrame().includes(marker), output.lastFrame());
  };
  await press('?');
  await waitForContent(content);
  await press('\t');
  await waitForContent(techniqueContent);
  assert.ok(!output.lastFrame().includes(content));
  await press('\x1b[D');
  await waitForContent(content);
  assert.equal(loads, 1);
  await press('\x1b');
  await press('\x1b[A', '\x1b[A', ' updated', '\x1b[A', '\r');
  assert.ok(saved);
  assert.equal(saved.name, `${editing.name}? updated`);
  assert.deepEqual(saved.read_sets, editing.read_sets);
  assert.equal(saved.wildtype, editing.wildtype);
});

test('technique headings count isolates once and stay visible through scrolling and edit/remove navigation', async context => {
  const input = new Input();
  const output = new Output();
  output.columns = 80;
  output.rows = 24;
  const entries = Array.from({length: 14}, (_, index): Isolate => ({
    ...fixture(), id: `sample-${index}`, name: `Sample ${index}`,
    read_sets: ['delivery', 'topup'].map((id, pair) => testReadSet([
      {r1: `/reads/${index}-${pair}-1.fq`, r2: `/reads/${index}-${pair}-2.fq`, trimmed: false},
    ], {id})),
  }));
  let catalog = {schema_version: 1 as const, isolates: entries};
  let updates = 0;
  const app = render(<IsolatesScreen onBack={() => {}} inputActive currentDirectory="/" catalogPath="/catalog.yaml"
    loadCatalog={async () => ({catalog, revision: 'current'})}
    updateCatalog={async (_revision, mutate) => {updates++; catalog = validateIsolateCatalog(mutate(catalog)); return {catalog, revision: 'next'};}}
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(output.lastFrame());
  };
  const press = async (key: string) => {input.write(key); await pause();};
  const selected = () => output.lastFrame().split('\n').find(line => line.startsWith('›')) ?? '';
  const platform = entries[0]!.read_sets[0]!.platform;
  const technique = platform.charAt(0).toUpperCase() + platform.slice(1);
  await waitFor(() => selected().includes(`(${entries[0]!.id})`));
  assert.ok(output.lastFrame().includes(`${technique} · ${entries.length}`));
  assert.equal(output.lastFrame().split(technique).length - 1, 1);
  await press('\x1b[A');
  await waitFor(() => selected().includes(`(${entries.at(-1)!.id})`));
  assert.ok(output.lastFrame().includes(`${technique} · ${entries.length}`));
  assert.ok(output.lastFrame().split('\n').length <= output.rows, output.lastFrame());
  await press('\r'); await press('\x1b');
  await waitFor(() => selected().includes(`(${entries.at(-1)!.id})`));
  await press('d'); await press('y');
  await waitFor(() => updates === 1 && output.lastFrame().includes(`${technique} · 13`));
  assert.equal(catalog.isolates.length, 13);
  assert.ok(catalog.isolates.every(entry => entry.id !== entries.at(-1)!.id));
});

test('edit groups pairs with padded buttons and displays technique only in isolate details', async context => {
  const input = new Input();
  const output = new Output();
  output.rows = 60;
  const editing = fixture();
  const second = {r1: '/reads/lane2-r1.fq', r2: '/reads/lane2-r2.fq', trimmed: false};
  editing.read_sets[0]!.read_pairs.push(second);
  let saved: Isolate | undefined;
  const app = render(<IsolateForm catalog={{schema_version: 1, isolates: [editing]}} editing={editing}
    onSubmit={async value => {saved = value;}} onCancel={() => {}} inputActive currentDirectory="/"
    checkReads={async pairs => ({pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const press = async (key: string) => {input.write(key); await pause();};
  await pause();
  const frame = output.lastFrame();
  const technique = isolateTechnique(editing);
  assert.equal(frame.split(technique).length - 1, 1);
  const lines = frame.split('\n');
  const libraryLine = lines.find(line => line.includes(editing.read_sets[0]!.library_id));
  assert.ok(libraryLine);
  const readSetIndent = libraryLine.match(/^ */)![0].length;
  for (const pair of editing.read_sets[0]!.read_pairs) {
    for (const mate of ['r1', 'r2'] as const) {
      const line = lines.find(value => value.includes(pair[mate]));
      assert.ok(line, `${mate} is visible in its pair section`);
      assert.ok(!/[│╭╮╰╯┌┐└┘]/.test(line), 'Pair paths use the shared borderless section layout.');
      assert.equal(line.match(/^ */)![0].length, readSetIndent + 2, 'Pair fields are indented inside their read set.');
    }
  }
  const buttons = lines.flatMap((line, index) => /^\[.+\]$/.test(line.trim()) ? [index] : []).slice(0, 3);
  assert.equal(buttons.length, 3);
  for (const index of buttons) {
    assert.equal(lines[index - 1]!.trim(), '');
    assert.equal(lines[index + 1]!.trim(), '');
  }
  assert.equal(lines.filter(line => /\[.+\]/.test(line)).length, 5);
  // Four isolate fields, four set fields, three pair fields, then the first remove action.
  for (let index = 0; index < 11; index++) {
    await press('\t');
  }
  await press('\r');
  // Removal returns focus to the set name; wrap back through isolate fields to save.
  for (let index = 0; index < 5; index++) {
    await press('\x1b[A');
  }
  await press('\r');
  assert.ok(saved);
  assert.deepEqual(saved.read_sets[0]!.read_pairs, [second]);
});

test('an empty isolate list uses a warning alert and still opens manual creation', async context => {
  const input = new Input();
  const output = new Output();
  let updates = 0;
  const app = render(<IsolatesScreen onBack={() => {}} inputActive currentDirectory="/project" catalogPath="/catalog.yaml"
    loadCatalog={async () => ({catalog: {schema_version: 1, isolates: []}, revision: undefined})}
    updateCatalog={async () => {updates++; throw new Error('unexpected save');}}
    checkReads={async () => ({pairs: [], sameFiles: []})} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  for (let attempt = 0; attempt < 100 && !output.lastFrame().includes('⚠'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(output.lastFrame().includes('⚠'), output.lastFrame());
  assert.ok(output.lastFrame().includes('╭'));
  input.write('n'); await pause();
  for (let attempt = 0; attempt < 100 && output.lastFrame().includes('⚠'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(!output.lastFrame().includes('⚠'));
  assert.ok(output.lastFrame().split('\n').some(line => /^› /.test(line)));
  assert.equal(updates, 0);
});

test('the defaults info appears after proposed isolates in import review, not during folder selection', async context => {
  const input = new Input();
  const output = new Output();
  output.columns = 80;
  output.rows = 24;
  const scan: DeliveryScan = {root: '/delivery-review-fixture', alreadyImported: [], skippedFiles: [], skippedDirectories: [],
    candidates: [{sample: 'Import sample', readSets: [{instrument: 'A00001', run: 1, flowcell: 'FLOWCELL', lane: 1, chunk: 1,
      variants: [{r1: '/delivery/reads_R1.fastq.gz', r2: '/delivery/reads_R2.fastq.gz', r1Bytes: 100, r2Bytes: 100,
        sampleNumber: 1, readLength: {min: 100, max: 100}, sampledReads: 1, suggestedTrimmed: false}]}]}]};
  let scans = 0;
  let saved = false;
  const loaded = {catalog: {schema_version: 1 as const, isolates: []}, revision: undefined};
  const app = render(<IsolateImport loaded={loaded} loadCatalog={async () => loaded}
    updateCatalog={async () => {saved = true; return loaded;}}
    checkReads={async () => ({pairs: [], sameFiles: []})}
    scanDelivery={async () => {scans++; return scan;}} inputActive currentDirectory="/project"
    readDirectory={async () => []} onDone={() => {}} onCancel={() => {}} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(output.lastFrame());
  };
  await waitFor(() => output.lastFrame().includes('/project') && output.lastFrame().includes('›'));
  assert.equal(scans, 0);
  assert.ok(!output.lastFrame().includes('⚠'));
  input.write('\r'); await pause();
  await waitFor(() => scans === 1 && output.lastFrame().includes(scan.root));
  assert.ok(!output.lastFrame().includes('⚠'));
  input.write('\r'); await pause();
  await waitFor(() => output.lastFrame().includes(scan.candidates[0]!.sample) && output.lastFrame().includes('ℹ'));
  const frame = output.lastFrame();
  assert.ok(frame.indexOf(scan.candidates[0]!.sample) < frame.indexOf('ℹ'));
  assert.ok(!frame.includes('⚠'));
  assert.ok(frame.split('\n').length <= output.rows, frame);
  assert.equal(saved, false);
});

test('catalog replacement retains other isolates and validates cross-isolate file conflicts', () => {
  const first = fixture();
  const second = {...fixture(), id: 'sample-b', name: 'B'};
  const catalog = {schema_version: 1 as const, isolates: [first]};
  assert.throws(() => validateIsolateCatalog(withIsolate(catalog, second)));
  const updated = {...first, name: 'Updated'};
  assert.deepEqual(withIsolate(catalog, updated, first.id).isolates, [updated]);
  assert.equal(catalog.isolates[0]!.name, first.name);
});
