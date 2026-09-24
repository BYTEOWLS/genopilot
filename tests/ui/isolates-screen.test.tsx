import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {validateIsolateCatalog, type Isolate, type IsolateCatalog} from '../../src/isolates/catalog.js';
import {checkReadPairs, type ReadPairsCheck, type ReadPairsChecker} from '../../src/isolates/reads.js';
import {
  IsolateCatalogChangedError,
  loadIsolateCatalog,
  updateIsolateCatalog,
  type LoadedIsolateCatalog,
} from '../../src/isolates/store.js';
import {expandHomeDirectory} from '../../src/ui/isolates-screen/isolate-form.js';
import {HomeSuspensionContext, type HomeSuspension} from '../../src/ui/home-navigation.js';
import {
  IsolatesScreen,
  type IsolateCatalogLoader,
  type IsolateCatalogUpdater,
} from '../../src/ui/isolates-screen/screen.js';

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
  columns = 120;
  readonly rows = 40;
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

const keys = {
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
};

function okReads(pairs: readonly unknown[]): ReadPairsCheck {
  return {pairs: pairs.map(() => ({r1: {state: 'ok'}, r2: {state: 'ok'}})), sameFiles: []};
}

function isolate(id: string, overrides: Partial<Isolate> = {}): Isolate {
  return {
    id,
    name: `Name of ${id}`,
    wildtype: true,
    derived_from: null,
    read_pairs: [{r1: `/data/${id}_R1.fq`, r2: `/data/${id}_R2.fq`, trimmed: false}],
    ...overrides,
  };
}

/** An in-memory stand-in for the catalog file that applies the same schema and revision rules. */
class MemoryCatalog {
  catalog: IsolateCatalog;
  revision = 0;
  loads = 0;
  updates = 0;

  constructor(...isolates: Isolate[]) {
    this.catalog = {schema_version: 1, isolates};
  }

  readonly load: IsolateCatalogLoader = async () => {
    this.loads += 1;
    return {catalog: structuredClone(this.catalog), revision: String(this.revision)};
  };

  readonly update: IsolateCatalogUpdater = async (expectedRevision, mutate) => {
    this.updates += 1;
    if (expectedRevision !== String(this.revision)) {
      throw new IsolateCatalogChangedError();
    }
    this.catalog = validateIsolateCatalog(mutate(structuredClone(this.catalog)));
    this.revision += 1;
    return {catalog: structuredClone(this.catalog), revision: String(this.revision)};
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  while (!condition()) {
    if (Date.now() > timeoutAt) {
      assert.fail('Timed out waiting for condition.');
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
}

async function waitForOutput(output: TestOutput, predicate: (value: string) => boolean): Promise<string> {
  await waitFor(() => predicate(output.readOutput())).catch(() => {
    assert.fail(`Timed out waiting for terminal output. Received:\n${output.readOutput()}`);
  });
  return output.readOutput();
}

/** Gives resolved promises and the resulting Ink render time to complete. */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 50));
}

/** Lets Ink process one input chunk and render before the next is written. */
async function press(input: TestInput, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    input.write(chunk);
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
}

function renderScreen(
  context: TestContext,
  options: {
    loadCatalog: IsolateCatalogLoader;
    updateCatalog: IsolateCatalogUpdater;
    checkReads?: ReadPairsChecker;
    onBack?: () => void;
    onSuspension?: (suspension: HomeSuspension | undefined) => void;
  },
): {input: TestInput; output: TestOutput} {
  const input = new TestInput();
  const output = new TestOutput();
  const screen = (
    <IsolatesScreen
      onBack={options.onBack ?? (() => {})}
      inputActive
      currentDirectory="/research/project"
      catalogPath="/researcher/isolates/isolates.yaml"
      loadCatalog={options.loadCatalog}
      updateCatalog={options.updateCatalog}
      checkReads={options.checkReads ?? (async pairs => okReads(pairs))}
    />
  );
  const instance = render(
    options.onSuspension ? (
      <HomeSuspensionContext.Provider value={(_id, suspension) => options.onSuspension?.(suspension)}>
        {screen}
      </HomeSuspensionContext.Provider>
    ) : screen,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  context.after(() => instance.unmount());
  return {input, output};
}

/**
 * Fills the new-isolate form in row order: name, ID, description, wild type, parent, then per read
 * pair R1, R2, trimmed (and a remove action once there are two pairs), then add-pair and save.
 */
async function createIsolate(
  input: TestInput,
  {name, parentSteps = 0, pairs}: {
    name: string;
    parentSteps?: number;
    pairs: {r1: string; r2: string; trimmed?: boolean}[];
  },
): Promise<void> {
  await press(input, 'n', name, keys.down, keys.down, keys.down, ' ', keys.down);
  for (let step = 0; step < parentSteps; step += 1) {
    await press(input, ' ');
  }
  await press(input, keys.down);
  for (const [index, pair] of pairs.entries()) {
    await press(input, pair.r1, keys.down, pair.r2, keys.down);
    if (pair.trimmed) {
      await press(input, ' ');
    }
    // A second pair adds a remove action to every pair, including this one.
    await press(input, keys.down);
    if (index < pairs.length - 1) {
      // Now on the add-pair action, which moves the selection to the new pair's R1.
      await press(input, keys.enter);
    }
  }
  if (pairs.length > 1) {
    // The last pair's remove action sits between its trimmed row and add-pair.
    await press(input, keys.down);
  }
  await press(input, keys.down, keys.enter);
}

test('lists every catalog isolate and checks each read pair', async context => {
  const store = new MemoryCatalog(isolate('isolate-a'), isolate('isolate-b', {derived_from: 'isolate-a'}));
  const checked: string[] = [];
  const {output} = renderScreen(context, {
    loadCatalog: store.load,
    updateCatalog: store.update,
    checkReads: async pairs => {
      checked.push(pairs[0]?.r1 ?? '');
      return okReads(pairs);
    },
  });

  await waitForOutput(output, value => value.includes('isolate-a') && value.includes('isolate-b'));
  await waitFor(() => checked.length === 2);
  assert.deepEqual(checked.sort(), ['/data/isolate-a_R1.fq', '/data/isolate-b_R1.fq']);
});

test('creates an isolate with a suggested ID and explicit metadata', async context => {
  const store = new MemoryCatalog(isolate('parent'));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('parent'));

  await createIsolate(input, {name: 'Strain X', parentSteps: 1, pairs: [{r1: '/data/x_R1.fq', r2: '/data/x_R2.fq'}]});

  await waitFor(() => store.catalog.isolates.length === 2);
  assert.deepEqual(store.catalog.isolates[1], {
    id: 'strain-x',
    name: 'Strain X',
    wildtype: true,
    derived_from: 'parent',
    read_pairs: [{r1: '/data/x_R1.fq', r2: '/data/x_R2.fq', trimmed: false}],
  });
});

test('creates an isolate with several trimmed read pairs', async context => {
  const store = new MemoryCatalog();
  const checkedPairs: number[] = [];
  const {input} = renderScreen(context, {
    loadCatalog: store.load,
    updateCatalog: store.update,
    checkReads: async pairs => {
      checkedPairs.push(pairs.length);
      return okReads(pairs);
    },
  });
  await waitFor(() => store.loads === 1);
  await settle();

  await createIsolate(input, {
    name: 'Two Lanes',
    pairs: [
      {r1: '/data/L7_R1.fq', r2: '/data/L7_R2.fq', trimmed: true},
      {r1: '/data/L8_R1.fq', r2: '/data/L8_R2.fq', trimmed: true},
    ],
  });

  await waitFor(() => store.catalog.isolates.length === 1);
  assert.deepEqual(store.catalog.isolates[0]?.read_pairs, [
    {r1: '/data/L7_R1.fq', r2: '/data/L7_R2.fq', trimmed: true},
    {r1: '/data/L8_R1.fq', r2: '/data/L8_R2.fq', trimmed: true},
  ]);
  assert.ok(checkedPairs.includes(2));
});

test('refuses to save an isolate that mixes trimmed and untrimmed pairs', async context => {
  const store = new MemoryCatalog();
  const {input} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitFor(() => store.loads === 1);
  await settle();

  await createIsolate(input, {
    name: 'Mixed',
    pairs: [
      {r1: '/data/L7_R1.fq', r2: '/data/L7_R2.fq', trimmed: true},
      {r1: '/data/L8_R1.fq', r2: '/data/L8_R2.fq'},
    ],
  });
  await settle();
  assert.equal(store.updates, 0);
});

test('removes a read pair while editing', async context => {
  const store = new MemoryCatalog(isolate('isolate-a', {
    read_pairs: [
      {r1: '/data/L7_R1.fq', r2: '/data/L7_R2.fq', trimmed: false},
      {r1: '/data/L8_R1.fq', r2: '/data/L8_R2.fq', trimmed: false},
    ],
  }));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('isolate-a'));

  // Edit rows: name, description, wild type, parent, pair 1 R1, R2, trimmed, remove.
  const downToFirstRemove = Array.from({length: 7}, () => keys.down);
  await press(input, keys.enter, ...downToFirstRemove, keys.enter);
  // The selection moves to the remaining pair's R1; its rows are R1, R2, trimmed, then add-pair, save.
  await press(input, keys.down, keys.down, keys.down, keys.down, keys.enter);

  await waitFor(() => store.updates === 1);
  assert.deepEqual(store.catalog.isolates[0]?.read_pairs, [
    {r1: '/data/L8_R1.fq', r2: '/data/L8_R2.fq', trimmed: false},
  ]);
});

test('expands home-relative read paths', () => {
  assert.equal(expandHomeDirectory('~/reads/x_R1.fq', '/home/researcher'), '/home/researcher/reads/x_R1.fq');
  assert.equal(expandHomeDirectory('~', '/home/researcher'), '/home/researcher');
  assert.equal(expandHomeDirectory('/data/~/x.fq', '/home/researcher'), '/data/~/x.fq');
  // `~user` needs a user database lookup; it stays unexpanded and is rejected as non-absolute.
  assert.equal(expandHomeDirectory('~other/x.fq', '/home/researcher'), '~other/x.fq');
});

test('saves a typed ~ path as an absolute path', async context => {
  const store = new MemoryCatalog();
  const {input} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitFor(() => store.loads === 1);
  await settle();

  await createIsolate(input, {name: 'Home Reads', pairs: [{r1: '~/reads/h_R1.fq', r2: '~/reads/h_R2.fq'}]});

  await waitFor(() => store.catalog.isolates.length === 1);
  assert.deepEqual(store.catalog.isolates[0]?.read_pairs, [
    {r1: join(homedir(), 'reads/h_R1.fq'), r2: join(homedir(), 'reads/h_R2.fq'), trimmed: false},
  ]);
});

test('names the other isolate when an edit conflicts with a later one', async context => {
  const store = new MemoryCatalog(isolate('isolate-a'), isolate('isolate-b'));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('isolate-b'));

  // Edit isolate-a so its R1 is isolate-b's R1; the catalog records the conflict on isolate-b.
  const downToR1 = Array.from({length: 4}, () => keys.down);
  await press(input, keys.enter, ...downToR1);
  const clearR1 = Array.from({length: '/data/isolate-a_R1.fq'.length}, () => '\x7f');
  await press(input, clearR1.join(''), '/data/isolate-b_R1.fq', keys.up, keys.up, keys.up, keys.up, keys.up);
  output.clearOutput();
  await press(input, keys.enter);
  await settle();

  assert.equal(store.updates, 0);
  // The form no longer shows the list, so the ID can only come from the conflict message.
  const frame = await waitForOutput(output, value => value.includes('isolate-b'));
  assert.doesNotMatch(frame, /\$\.isolates/);
});

test('refuses to save while required fields or read files are invalid', async context => {
  const store = new MemoryCatalog();
  const {input, output} = renderScreen(context, {
    loadCatalog: store.load,
    updateCatalog: store.update,
    checkReads: async () => ({
      pairs: [{r1: {state: 'ok'}, r2: {state: 'missing', reason: 'file not found'}}],
      sameFiles: [],
    }),
  });
  await waitFor(() => store.loads === 1);
  await settle();

  // Saving without a wild-type choice is refused before any file is checked.
  await press(input, 'n', 'Strain Y', keys.tab, keys.tab, keys.tab, keys.tab, keys.tab, '/data/y_R1.fq');
  await press(input, keys.tab, '/data/y_R2.fq', keys.tab, keys.tab, keys.tab, keys.enter);
  await settle();
  assert.equal(store.updates, 0);

  // Choosing it still leaves the missing R2 file blocking the save.
  const upToWildtype = Array.from({length: 6}, () => keys.up);
  const downToSave = Array.from({length: 6}, () => keys.down);
  await press(input, ...upToWildtype, ' ', ...downToSave, keys.enter);
  await settle();
  assert.equal(store.updates, 0);
  assert.equal(store.catalog.isolates.length, 0);
  assert.match(output.readOutput(), /file not found/);
});

test('edits an isolate without changing its stable ID', async context => {
  const store = new MemoryCatalog(isolate('isolate-a', {name: 'Old'}));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('isolate-a'));

  // The edit form has no ID field: name, description, wild type, parent, R1, R2, save.
  await press(input, keys.enter, ' renamed', keys.up, keys.enter);

  await waitFor(() => store.updates === 1);
  assert.equal(store.catalog.isolates[0]?.id, 'isolate-a');
  assert.equal(store.catalog.isolates[0]?.name, 'Old renamed');
});

test('removes an isolate only after confirmation', async context => {
  const store = new MemoryCatalog(isolate('isolate-a'), isolate('isolate-b'));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('isolate-b'));

  await press(input, keys.down, 'd', 'n');
  assert.equal(store.updates, 0);
  await press(input, 'd', keys.escape);
  assert.equal(store.updates, 0);

  await press(input, 'd', 'y');
  await waitFor(() => store.updates === 1);
  assert.deepEqual(store.catalog.isolates.map(entry => entry.id), ['isolate-a']);
});

test('refuses to remove an isolate that others are derived from', async context => {
  const store = new MemoryCatalog(isolate('parent'), isolate('child', {derived_from: 'parent'}));
  let backCalls = 0;
  const {input, output} = renderScreen(context, {
    loadCatalog: store.load,
    updateCatalog: store.update,
    onBack: () => {
      backCalls += 1;
    },
  });
  await waitForOutput(output, value => value.includes('child'));

  await press(input, 'd', 'y');
  await settle();
  assert.equal(store.updates, 0);
  assert.equal(store.catalog.isolates.length, 2);
  // No confirmation is pending, so Esc leaves the screen.
  await press(input, keys.escape);
  assert.equal(backCalls, 1);
});

test('keeps the form open when another window changed the catalog, then reloads on request', async context => {
  const store = new MemoryCatalog(isolate('isolate-a'));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('isolate-a'));
  store.revision += 1;

  await press(input, keys.enter, ' changed', keys.up, keys.enter);
  await waitFor(() => store.updates === 1);
  await settle();
  assert.equal(store.catalog.isolates[0]?.name, 'Name of isolate-a');

  await press(input, keys.escape, 'r');
  await waitFor(() => store.loads === 2);
  await press(input, keys.enter, ' changed', keys.up, keys.enter);
  await waitFor(() => store.catalog.isolates[0]?.name === 'Name of isolate-a changed');
});

test('offers no edits when the catalog cannot be loaded', async context => {
  let updates = 0;
  const {input, output} = renderScreen(context, {
    loadCatalog: async () => {
      throw new Error('catalog is corrupt');
    },
    updateCatalog: async () => {
      updates += 1;
      throw new Error('unexpected');
    },
  });
  await waitForOutput(output, value => value.includes('catalog is corrupt'));

  await press(input, 'n', 'Name', keys.enter, keys.enter);
  assert.equal(updates, 0);
});

test('suspends the home shortcut while a text field has focus', async context => {
  const store = new MemoryCatalog();
  const suspensions: (HomeSuspension | undefined)[] = [];
  const {input} = renderScreen(context, {
    loadCatalog: store.load,
    updateCatalog: store.update,
    onSuspension: suspension => suspensions.push(suspension),
  });
  await waitFor(() => store.loads === 1);
  await settle();
  assert.equal(suspensions.at(-1), undefined);

  await press(input, 'n');
  await waitFor(() => suspensions.at(-1) === 'typing');
  // The wild-type choice takes no text, so the shortcut is available again there.
  await press(input, keys.down, keys.down, keys.down);
  await waitFor(() => suspensions.at(-1) === undefined);
});

test('stays usable after the terminal is resized', async context => {
  const store = new MemoryCatalog(isolate('isolate-a'), isolate('isolate-b'));
  const {input, output} = renderScreen(context, {loadCatalog: store.load, updateCatalog: store.update});
  await waitForOutput(output, value => value.includes('isolate-b'));

  output.columns = 42;
  output.emit('resize');
  await press(input, keys.down, 'd', 'y');
  await waitFor(() => store.updates === 1);
  assert.deepEqual(store.catalog.isolates.map(entry => entry.id), ['isolate-a']);
});

test('persists created isolates across a restart with the real store and read checks', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-isolates-ui-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const catalogPath = join(directory, 'catalog', 'isolates.yaml');
  const r1 = join(directory, 'sample_R1.fq');
  const r2 = join(directory, 'sample_R2.fq');
  await writeFile(r1, '@r/1\nACGT\n+\nIIII\n');
  await writeFile(r2, '@r/2\nACGT\n+\nIIII\n');
  let loadsCompleted = 0;
  const loadCatalog = async (): Promise<LoadedIsolateCatalog> => {
    const loaded = await loadIsolateCatalog(catalogPath);
    loadsCompleted += 1;
    return loaded;
  };
  let savesCompleted = 0;
  const updateCatalog: IsolateCatalogUpdater = async (revision, mutate) => {
    const saved = await updateIsolateCatalog(catalogPath, revision, mutate);
    savesCompleted += 1;
    return saved;
  };

  const first = renderScreen(context, {loadCatalog, updateCatalog, checkReads: checkReadPairs});
  await waitFor(() => loadsCompleted === 1);
  await settle();
  await createIsolate(first.input, {name: 'Sample One', pairs: [{r1, r2}]});
  // Wait for the save itself: the ID also appears in the form while it is being filled in.
  await waitFor(() => savesCompleted === 1);

  const second = renderScreen(context, {loadCatalog, updateCatalog, checkReads: checkReadPairs});
  await waitForOutput(second.output, value => value.includes('sample-one'));
  const {catalog} = await loadIsolateCatalog(catalogPath);
  assert.deepEqual(catalog.isolates.map(entry => [entry.id, entry.read_pairs]), [
    ['sample-one', [{r1, r2, trimmed: false}]],
  ]);
});
