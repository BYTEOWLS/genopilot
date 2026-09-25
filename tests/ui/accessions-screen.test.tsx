import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import type {CacheScan, ScannedCopy} from '../../src/accessions/cache-discovery.js';
import {
  emptyAccessionCatalog,
  validateAccessionCatalog,
  type AccessionCatalog,
  type AccessionEntry,
  type NcbiAssemblyMetadata,
} from '../../src/accessions/catalog.js';
import type {MetadataFetchResult} from '../../src/accessions/ncbi-metadata.js';
import type {AccessionCatalogMutation, LoadedAccessionCatalog} from '../../src/accessions/store.js';
import {AccessionsScreen} from '../../src/ui/accessions-screen/screen.js';

const ENTER = '\r';
const ARROW_DOWN_KEY = '\x1b[B';
const ESCAPE = '\x1b';
const TAB = '\t';
const accession = 'GCF_000149205.2';
const other = 'GCA_000000001.1';
// Typed into the add form; unlike `accession`, it never appears in the field's placeholder.
const typed = 'GCA_000000002.1';
const checksum = 'a'.repeat(64);

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
  readonly rows = 40;
  readonly isTTY = false;
  private output = '';

  constructor(readonly columns = 120) {
    super();
  }

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  read(): string {
    return this.output;
  }

  clear(): void {
    this.output = '';
  }
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
  const timeoutAt = Date.now() + 2000;
  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

/**
 * Lets React finish the work a render left behind. Ink draws a frame when React commits it, but a
 * newly shown field starts listening for keys in an effect that React's scheduler runs later, in
 * `setImmediate` turns of at least one task each; a key written in between is dropped. A few turns
 * cover the effects and anything they schedule.
 */
async function effectsSettled(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

/** Waits for output matching `predicate` and for the drawn screen to listen for keys. */
async function waitForOutput(output: TestOutput, predicate: (value: string) => boolean): Promise<string> {
  const timeoutAt = Date.now() + 2000;
  while (!predicate(output.read())) {
    if (Date.now() >= timeoutAt) {
      // The output when the wait gave up, not when it began.
      assert.fail(`Timed out waiting for terminal output. Received:\n${output.read()}`);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  await effectsSettled();
  return output.read();
}

// Ink holds a lone Escape this long in case it starts a key sequence (`pendingInputFlushDelay`).
const inkEscapeDelayMilliseconds = 20;

/**
 * Lets Ink handle one keypress before the next arrives. Ink reads stdin and runs the key handlers
 * synchronously, so an empty input buffer means the key was handled, except a lone Escape, which
 * Ink passes on from a timer. A timer started afterwards with the same delay fires after Ink's, as
 * Node fires timers by deadline. Then whatever the key showed starts listening for keys.
 */
async function press(input: TestInput, key: string): Promise<void> {
  input.write(key);
  await waitFor(() => input.readableLength === 0, 'the key to be handled');
  if (key === ESCAPE) {
    await new Promise<void>(resolve => setTimeout(resolve, inkEscapeDelayMilliseconds));
  }
  await effectsSettled();
}

/** ↓ moves from the accession field to the look-up button; Enter there looks it up. */
async function lookUp(input: TestInput): Promise<void> {
  await press(input, ARROW_DOWN_KEY);
  await press(input, ENTER);
}

/** ↑ from the first detail field wraps to the save button; Enter there saves. */
async function saveDetails(input: TestInput): Promise<void> {
  await press(input, '\x1b[A');
  await press(input, ENTER);
}

/** ↓ moves from the typed path to its add button; Enter there adds the root. */
async function addTypedRoot(input: TestInput): Promise<void> {
  await press(input, ARROW_DOWN_KEY);
  await press(input, ENTER);
}

/** Lets a newly opened form take keyboard input. */
async function settle(): Promise<void> {
  await effectsSettled();
}

function metadata(organism: string): NcbiAssemblyMetadata {
  return {organism, retrieved_at: '2026-01-01T12:00:00.000Z', source: 'datasets-v2-rest'};
}

function entry(id: string, overrides: Partial<AccessionEntry> = {}): AccessionEntry {
  return {accession: id, ncbi: null, cached_copies: [], ...overrides};
}

function copy(id: string, root: string, state: ScannedCopy['state'], problem?: string): ScannedCopy {
  return {
    accession: id,
    root,
    path: `${root}/ncbi-accessions-cache/${id}`,
    state,
    ...(state === 'verified' ? {fasta_sha256: checksum} : {problem}),
  };
}

function renderScreen(
  context: TestContext,
  {
    catalog = emptyAccessionCatalog(),
    copies = [],
    fetch = async () => ({state: 'retrieved', metadata: metadata('Fetched organism')}),
    deleteCaches = async () => [],
    columns,
    scanGate,
    ignored = [],
  }: {
    ignored?: CacheScan['ignored'];
    /** Holds every scan until it resolves, as hashing large assemblies would. */
    scanGate?: Promise<void>;
    catalog?: AccessionCatalog;
    copies?: ScannedCopy[];
    fetch?: (id: string) => Promise<MetadataFetchResult>;
    deleteCaches?: (roots: readonly string[], id: string) => Promise<string[]>;
    columns?: number;
  } = {},
) {
  let loaded: LoadedAccessionCatalog = {catalog: validateAccessionCatalog(catalog), revision: 'r0'};
  let writes = 0;
  const scans: (readonly string[])[] = [];
  let scansCompleted = 0;
  const fetches: string[] = [];
  const deletions: {roots: readonly string[]; accession: string}[] = [];
  let currentCopies = copies;
  const input = new TestInput();
  const output = new TestOutput(columns);
  let backs = 0;
  const instance = render(
    <AccessionsScreen
      onBack={() => {
        backs += 1;
      }}
      inputActive
      currentDirectory="/project"
      catalogPath="/researcher/accessions/accessions.yaml"
      loadCatalog={async () => loaded}
      updateCatalog={async (revision: string | undefined, mutate: AccessionCatalogMutation) => {
        assert.equal(revision, loaded.revision);
        writes += 1;
        loaded = {catalog: validateAccessionCatalog(mutate(structuredClone(loaded.catalog))), revision: `r${String(writes)}`};
        return loaded;
      }}
      scanCaches={async roots => {
        scans.push(roots);
        await scanGate;
        scansCompleted += 1;
        return {scannedAt: '2026-01-01T12:00:00.000Z', cacheDirectories: roots.map(root => `${root}/ncbi-accessions-cache`), copies: currentCopies, ignored, rootProblems: []} satisfies CacheScan;
      }}
      fetchMetadata={async id => {
        fetches.push(id);
        return fetch(id);
      }}
      deleteCaches={async (roots, id) => {
        deletions.push({roots, accession: id});
        const deleted = await deleteCaches(roots, id);
        currentCopies = currentCopies.filter(candidate => candidate.accession !== id);
        return deleted;
      }}
      checkApiKeyConfigured={async () => false}
      saveApiKey={async () => undefined}
      clearApiKey={async () => undefined}
      apiKeyPath="/researcher/secrets/ncbi-api-key"
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
    scans,
    fetches,
    deletions,
    get catalog() {
      return loaded.catalog;
    },
    get writes() {
      return writes;
    },
    get backs() {
      return backs;
    },
    get scansCompleted() {
      return scansCompleted;
    },
  };
}

/**
 * Waits until the first cache scan has finished and the screen has shown its result; until then
 * the screen refuses removals and rescans.
 */
async function ready(screen: {scansCompleted: number}): Promise<void> {
  await waitFor(() => screen.scansCompleted >= 1, 'the first cache scan');
  await effectsSettled();
}

test('records verified caches on open and shows damaged copies without trusting them', async context => {
  const screen = renderScreen(context, {
    copies: [
      copy(accession, '/project/runs', 'verified'),
      copy(other, '/project/runs', 'checksum-invalid', 'genomic.fna does not match its recorded checksum'),
    ],
  });

  await waitFor(() => screen.writes === 1, 'discovery to save');
  assert.deepEqual(screen.scans[0], ['/project/runs']);
  assert.deepEqual(screen.catalog.accessions.map(candidate => candidate.accession), [accession]);
  const frame = await waitForOutput(screen.output, value => value.includes('genomic.fna does not match'));
  assert.match(frame, new RegExp(`${other}`));
});

test('adds an accession with its looked-up metadata and without downloading anything', async context => {
  const screen = renderScreen(context);
  await ready(screen);

  await press(screen.input, 'n');
  await settle();
  screen.input.write(accession.toLowerCase());
  await waitForOutput(screen.output, value => value.includes(accession.toLowerCase()));
  await lookUp(screen.input);
  await waitFor(() => screen.fetches.length === 1, 'the metadata lookup');
  await waitForOutput(screen.output, value => value.includes('Fetched organism'));
  screen.input.write('Backbone');
  await waitForOutput(screen.output, value => value.includes('Backbone'));
  await saveDetails(screen.input);

  await waitFor(() => screen.catalog.accessions.length === 1, 'the entry to be saved');
  // The form stayed open on its own page and received the accession.
  assert.deepEqual(screen.fetches, [accession]);
  assert.deepEqual(screen.catalog.accessions[0], {
    accession,
    name: 'Backbone',
    ncbi: metadata('Fetched organism'),
    cached_copies: [],
  });
  assert.deepEqual(screen.deletions, []);
});

test('saves an accession without metadata when NCBI is unreachable', async context => {
  const screen = renderScreen(context, {
    fetch: async () => ({state: 'failed', kind: 'offline', message: 'NCBI could not be reached.'}),
  });
  await ready(screen);

  await press(screen.input, 'n');
  await settle();
  screen.input.write(typed);
  await waitForOutput(screen.output, value => value.includes(typed));
  await lookUp(screen.input);
  await waitForOutput(screen.output, value => value.includes('NCBI could not be reached.'));
  await saveDetails(screen.input);

  await waitFor(() => screen.catalog.accessions.length === 1, 'the entry to be saved');
  assert.equal(screen.catalog.accessions[0]?.ncbi, null);
});

test('does not add an accession NCBI does not know', async context => {
  const screen = renderScreen(context, {
    fetch: async () => ({state: 'failed', kind: 'not-found', message: 'NCBI has no such assembly.'}),
  });
  await ready(screen);

  await press(screen.input, 'n');
  await settle();
  screen.input.write(typed);
  await waitForOutput(screen.output, value => value.includes(typed));
  await lookUp(screen.input);
  await waitForOutput(screen.output, value => value.includes('NCBI has no such assembly.'));
  await press(screen.input, ENTER);
  await press(screen.input, ENTER);

  assert.equal(screen.fetches.length, 3);
  assert.equal(screen.writes, 0);
});

test('edits only the local name and keeps fetched facts', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'Old', ncbi: metadata('Kept organism')})]},
  });
  await waitForOutput(screen.output, value => value.includes('Kept organism'));

  await press(screen.input, ENTER);
  screen.input.write(' label');
  await waitForOutput(screen.output, value => value.includes('Old label'));
  await saveDetails(screen.input);

  await waitFor(() => screen.catalog.accessions[0]?.name === 'Old label', 'the edit to be saved');
  assert.deepEqual(screen.catalog.accessions[0]?.ncbi, metadata('Kept organism'));
  assert.deepEqual(screen.fetches, []);
});

test('refreshes metadata independently of any assembly download', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {ncbi: metadata('Stale')})]},
  });
  await waitForOutput(screen.output, value => value.includes('Stale'));

  await press(screen.input, 'm');

  await waitFor(() => screen.catalog.accessions[0]?.ncbi?.organism === 'Fetched organism', 'the refresh');
  assert.deepEqual(screen.deletions, []);
});

test('removing a cached entry deletes its cache directories under every known root', async context => {
  const screen = renderScreen(context, {
    catalog: {
      ...emptyAccessionCatalog(),
      output_roots: ['/analysis/other'],
      accessions: [entry(accession, {ncbi: metadata('Organism')})],
    },
    copies: [copy(accession, '/project/runs', 'verified'), copy(accession, '/analysis/other', 'incomplete', 'genomic.fna is missing')],
  });
  await waitForOutput(screen.output, value => value.includes('genomic.fna is missing'));

  await press(screen.input, 'd');
  await waitForOutput(screen.output, value => value.includes('/analysis/other/ncbi-accessions-cache'));
  await press(screen.input, 'y');

  await waitFor(() => screen.catalog.accessions.length === 0, 'the removal');
  assert.deepEqual(screen.deletions, [{roots: ['/project/runs', '/analysis/other'], accession}]);
  await waitFor(() => screen.scans.length === 2, 'a rescan after removal');
});

test('keeps the entry when deleting its cache fails', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession)]},
    copies: [copy(accession, '/project/runs', 'verified')],
    deleteCaches: async () => {
      throw new Error('permission denied');
    },
  });
  await waitFor(() => screen.writes === 1, 'discovery to record the copy');
  await ready(screen);

  await press(screen.input, 'd');
  await press(screen.input, 'y');

  await waitForOutput(screen.output, value => value.includes('permission denied'));
  assert.equal(screen.catalog.accessions.length, 1);
});

test('adds and forgets output roots from their tab and rescans them', async context => {
  const screen = renderScreen(context);
  await ready(screen);

  await press(screen.input, TAB);
  await press(screen.input, 't');
  screen.input.write('/analysis/other');
  await waitForOutput(screen.output, value => value.includes('/analysis/other'));
  await addTypedRoot(screen.input);

  await waitFor(() => screen.catalog.output_roots.length === 1, 'the root to be stored');
  await waitFor(() => screen.scans.some(roots => roots.includes('/analysis/other')), 'a rescan');

  await press(screen.input, 'd');
  await waitFor(() => screen.catalog.output_roots.length === 0, 'the default root to be kept');
  await press(screen.input, '\x1b[B');
  await press(screen.input, 'd');
  // The current directory's runs folder is always scanned and cannot be forgotten.
  assert.deepEqual(screen.catalog.output_roots, []);
});

test('returns with Escape from the tab bar but not from an open form', async context => {
  const screen = renderScreen(context);
  await ready(screen);

  await press(screen.input, 'n');
  await press(screen.input, ESCAPE);
  assert.equal(screen.backs, 0);
  await press(screen.input, ESCAPE);
  assert.equal(screen.backs, 1);
});

test('stays usable on a narrow terminal', async context => {
  const screen = renderScreen(context, {
    columns: 40,
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'A long researcher label', ncbi: metadata('Organism')})]},
  });

  const frame = await waitForOutput(screen.output, value => value.includes('A long researcher'));
  assert.ok(frame.split('\n').every(line => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length <= 40));
});

const ARROW_LEFT = '\x1b[D';
const ARROW_RIGHT = '\x1b[C';

test('switches tabs with ←/→ like the file browser moves between folders', async context => {
  const screen = renderScreen(context);
  await ready(screen);

  await press(screen.input, ARROW_RIGHT);
  await press(screen.input, 't');
  screen.input.write('/analysis/other');
  await waitForOutput(screen.output, value => value.includes('/analysis/other'));
  await addTypedRoot(screen.input);
  await waitFor(() => screen.catalog.output_roots.length === 1, 'the root added on the roots tab');
  // Adding a root rescans; the tab takes keys again once the save and that scan are shown.
  await waitFor(() => screen.scansCompleted >= 2, 'the rescan after adding the root');
  await effectsSettled();

  // ← from the roots tab returns to the accession list, whose n opens the add form.
  await press(screen.input, ARROW_LEFT);
  await press(screen.input, 'n');
  await settle();
  screen.input.write(typed);
  await waitForOutput(screen.output, value => value.includes(typed));
  await lookUp(screen.input);
  await waitFor(() => screen.fetches.length === 1, 'the lookup from the accession tab');
});

test('leaves ←/→ to the API-key cursor while a key is being typed', async context => {
  const screen = renderScreen(context);
  await ready(screen);

  // ← from the first tab wraps to the API-key tab, which shows where the key is stored.
  await press(screen.input, ARROW_LEFT);
  await waitForOutput(screen.output, value => value.includes('/researcher/secrets/ncbi-api-key'));
  screen.input.write('ab');
  await waitForOutput(screen.output, value => value.includes('**'));
  await press(screen.input, ARROW_LEFT);
  screen.output.clear();
  await press(screen.input, 'X');
  // The key tab is still active: ← moved the cursor, and the next character joined the draft.
  await waitForOutput(screen.output, value => value.includes('***'));
});

test('shows every cached and damaged copy when an entry is opened', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), output_roots: ['/analysis/other'], accessions: [entry(accession, {ncbi: metadata('Organism')})]},
    copies: [
      copy(accession, '/project/runs', 'verified'),
      copy(accession, '/analysis/other', 'checksum-invalid', 'genomic.fna does not match its recorded checksum'),
    ],
  });
  await waitFor(() => screen.writes === 1, 'discovery to record the verified copy');
  await ready(screen);

  screen.output.clear();
  await press(screen.input, ENTER);

  const frame = await waitForOutput(screen.output, value => value.includes('genomic.fna does not match its recorded checksum'));
  assert.match(frame, /\/project\/runs\/ncbi-accessions-cache\/GCF_000149205\.2/);
  assert.match(frame, /\/analysis\/other\/ncbi-accessions-cache\/GCF_000149205\.2/);
  assert.match(frame, /Organism/);
});

test('lists the saved catalog while its caches are still being verified', async context => {
  let finishScan = (): void => {};
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'Saved backbone'})]},
    copies: [copy(accession, '/project/runs', 'verified')],
    scanGate: new Promise<void>(resolve => {
      finishScan = resolve;
    }),
  });

  await waitForOutput(screen.output, value => value.includes('Saved backbone'));
  assert.equal(screen.writes, 0);

  // Removing waits for the scan, which could otherwise put the removed entry back.
  await press(screen.input, 'd');
  await press(screen.input, 'y');
  assert.deepEqual(screen.deletions, []);

  finishScan();
  await waitFor(() => screen.writes === 1, 'the verified copy to be recorded');
  await press(screen.input, 'd');
  await press(screen.input, 'y');
  await waitFor(() => screen.deletions.length === 1, 'the removal after verification');
});

test('lists cache entries that discovery skipped, with the reason', async context => {
  const link = '/project/runs/ncbi-accessions-cache/GCF_000000005.1';
  const screen = renderScreen(context, {
    ignored: [{path: link, reason: 'is a symbolic link, which is not followed'}],
  });

  const frame = await waitForOutput(screen.output, value => value.includes(link));
  assert.match(frame, /symbolic link/);
});
