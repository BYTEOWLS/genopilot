import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {GenomeProviderRegistry} from '../../src/accessions/provider.js';
import {ncbiMetadata} from '../../src/accessions/provider/ncbi/index.js';
import type {NcbiAssemblyMetadata} from '../../src/accessions/provider/ncbi/metadata.js';
import assert from 'node:assert/strict';
import {formatLocalDate} from '../../src/ui/utils.js';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {defaultTheme} from '@inkjs/ui';
import type {CacheScan, ScannedCopy} from '../../src/accessions/cache-discovery.js';
import {
  emptyAccessionCatalog,
  validateAccessionCatalog,
  type AccessionCatalog,
  type AccessionEntry,
} from '../../src/accessions/catalog.js';
import type {MetadataFetchResult} from '../../src/accessions/provider/ncbi/metadata-fetch.js';
import type {AccessionCatalogMutation, LoadedAccessionCatalog} from '../../src/accessions/store.js';
import {AccessionsScreen} from '../../src/ui/accessions-screen/screen.js';
import type {CatalogDownloader} from '../../src/ui/accessions-screen/download-form.js';
import {formatBytes} from '../../src/workflows/systems-check.js';
import {effectsSettled, pressKey as press, waitFor, waitForOutput as waitForTerminal} from '../wait.js';

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

/** Waits for output matching `predicate` and for the drawn screen to listen for keys. */
async function waitForOutput(output: TestOutput, predicate: (value: string) => boolean): Promise<string> {
  return waitForTerminal(() => output.read(), predicate);
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
const settle = effectsSettled;

function metadata(organism: string): NcbiAssemblyMetadata {
  return {organism, retrieved_at: '2026-01-01T12:00:00.000Z', source: 'datasets-v2-rest'};
}

function entry(id: string, overrides: Partial<AccessionEntry> = {}): AccessionEntry {
  return {source: 'ncbi', id: id, parameters: {}, metadata: null, cached_copies: [], ...overrides};
}

function copy(id: string, root: string, state: ScannedCopy['state'], problem?: string): ScannedCopy {
  return {
    source: 'ncbi', id: id, parameters: {},
    metadata: null,
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
    download = async () => { throw new Error('Unexpected download.'); },
  }: {
    download?: CatalogDownloader;
    ignored?: CacheScan['ignored'];
    /** Holds every scan until it resolves, as hashing large assemblies would. */
    scanGate?: Promise<void>;
    catalog?: AccessionCatalog;
    copies?: ScannedCopy[];
    fetch?: (id: string, signal: AbortSignal) => Promise<MetadataFetchResult>;
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
  let configurations = 0;
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
      registry={new GenomeProviderRegistry([{...ncbiProvider, lookupMetadata: async (reference, context) => {
        fetches.push(reference.id);
        const result = await fetch(reference.id, context.signal);
        if (result.state === 'failed') { throw new Error(result.message); }
        return result.metadata;
      }}])}
      settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
      download={download}
      onConfigureProvider={() => { configurations += 1; }}
      deleteCaches={async (roots, reference) => {
        const id = reference.id;
        deletions.push({roots, accession: id});
        const deleted = await deleteCaches(roots, id);
        currentCopies = currentCopies.filter(candidate => candidate.id !== id);
        return deleted;
      }}
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
    get configurations() {
      return configurations;
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

test('saving reviewed metadata adds a selectable catalog entry with no cached files', async context => {
  const facts = metadata('metadata-only-organism-marker');
  const screen = renderScreen(context, {fetch: async () => ({state: 'retrieved', metadata: facts})});
  await ready(screen);
  await press(screen.input, 'n');
  await press(screen.input, ENTER);
  await press(screen.input, typed);
  await press(screen.input, '\x1b[A');
  await press(screen.input, ENTER);
  await waitForOutput(screen.output, value => value.includes(facts.organism));
  assert.equal(screen.catalog.accessions.length, 0);
  await press(screen.input, '\x1b[A');
  await press(screen.input, ENTER);
  await waitFor(() => screen.catalog.accessions.length === 1, 'saved metadata');
  assert.deepEqual(screen.catalog.accessions[0], entry(typed, {metadata: facts}));
  assert.equal(screen.scansCompleted, 1, 'saving metadata does not trigger a download/cache rescan');
  // The new entry is selected and can be reopened without another remote lookup.
  await press(screen.input, ENTER);
  assert.equal(screen.fetches.length, 1);
});

test('metadata-only refresh preserves existing labels and verified cache copies', async context => {
  const facts = metadata('refreshed-metadata-marker');
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'preserved-name', description: 'preserved-description'})]},
    copies: [copy(accession, '/project/runs', 'verified')],
    fetch: async () => ({state: 'retrieved', metadata: facts}),
  });
  await ready(screen);
  const before = structuredClone(screen.catalog.accessions[0]!);
  await press(screen.input, 'n');
  await press(screen.input, ENTER);
  await press(screen.input, accession);
  await press(screen.input, '\x1b[A');
  await press(screen.input, ENTER);
  await waitForOutput(screen.output, value => value.includes(facts.organism));
  await press(screen.input, '\x1b[A');
  await press(screen.input, ENTER);
  await waitFor(() => ncbiMetadata(screen.catalog.accessions[0]!.metadata)?.organism === facts.organism, 'updated metadata');
  assert.deepEqual(screen.catalog.accessions[0], {...before, metadata: facts});
  assert.equal(screen.scansCompleted, 1);
});

test('the list ignores the former download shortcut and inline download cancellation retains editor drafts', async context => {
  let signal: AbortSignal | undefined;
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'draft-marker'})]},
    download: async (_request, context) => {
      signal = context.signal;
      context.onProgress?.({phase: 'downloading', bytes: 1024});
      return new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), {once: true}));
    },
  });
  await ready(screen);
  await press(screen.input, 'g');
  await press(screen.input, ENTER);
  await press(screen.input, '-changed');
  await press(screen.input, TAB);
  await press(screen.input, TAB);
  await press(screen.input, 'g');
  await waitFor(() => signal !== undefined, 'download starts without another form');
  await waitForOutput(screen.output, value => value.includes(formatBytes(1024)));
  await press(screen.input, ESCAPE);
  await waitFor(() => signal!.aborted, 'download cancelled');
  await effectsSettled();
  await press(screen.input, TAB);
  await press(screen.input, TAB);
  await press(screen.input, ENTER);
  await waitFor(() => screen.catalog.accessions[0]?.name === 'draft-marker-changed', 'draft saved after cancelling download');
  assert.deepEqual(screen.fetches, []);
  assert.equal(screen.backs, 0);
});

for (const annotation of ['available', 'unavailable'] as const) {
  test(`editor download reports ${annotation} annotation in the appropriate alert and retains unsaved labels`, async context => {
  let complete!: () => void;
  const transfer = new Promise<void>(resolve => { complete = resolve; });
  context.after(() => complete());
  let downloads = 0;
  const facts = metadata('downloaded-metadata-marker');
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'draft-marker'})]},
    download: async (request, context) => {
      downloads += 1;
      assert.deepEqual(request, {
        reference: {source: 'ncbi', id: accession, parameters: {}},
        kinds: ['fasta', 'gff3'], root: '/project/runs', mode: 'refresh',
      });
      context.onProgress?.({phase: 'downloading', bytes: 1024, total: 4096});
      await transfer;
      return {reference: request.reference, metadata: facts, facts: {}, downloaded: true, annotation};
    },
  });
  await ready(screen);
  await press(screen.input, ENTER);
  await press(screen.input, '-changed');
  await press(screen.input, TAB);
  await press(screen.input, TAB);
  await press(screen.input, ENTER);
  await waitFor(() => downloads === 1, 'button starts direct download');
  await waitForOutput(screen.output, value => value.includes(formatBytes(4096)));
  await press(screen.input, 'g');
  assert.equal(downloads, 1, 'busy editor cannot start a duplicate transfer');
  complete();
  await waitFor(() => screen.scansCompleted === 2, 'download completion rescans caches');
  await effectsSettled();
  const config = defaultTheme.components.Alert!.config as (props: {variant: string}) => {icon: string};
  const variant = annotation === 'unavailable' ? 'warning' : 'info';
  await waitForOutput(screen.output, value => value.includes(config({variant}).icon));
  assert.equal(screen.catalog.accessions[0]?.name, 'draft-marker');
  assert.deepEqual(screen.fetches, [], 'no metadata-review request precedes the transfer');
  await press(screen.input, TAB);
  await press(screen.input, TAB);
  await press(screen.input, ENTER);
  await waitFor(() => screen.catalog.accessions[0]?.name === 'draft-marker-changed', 'editor draft saved after download');
  assert.deepEqual(screen.catalog.accessions[0]?.metadata, facts);
  });
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
  assert.deepEqual(screen.catalog.accessions.map(candidate => candidate.id), [accession]);
  const frame = await waitForOutput(screen.output, value => value.includes('genomic.fna does not match'));
  assert.match(frame, new RegExp(`${other}`));
});

test('edits only the local name and keeps fetched facts', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'Old', metadata: metadata('Kept organism')})]},
  });
  await waitForOutput(screen.output, value => value.includes('Kept organism'));

  await press(screen.input, ENTER);
  await press(screen.input, ' label');
  await waitForOutput(screen.output, value => value.includes('Old label'));
  await saveDetails(screen.input);

  await waitFor(() => screen.catalog.accessions[0]?.name === 'Old label', 'the edit to be saved');
  assert.deepEqual(screen.catalog.accessions[0]?.metadata, metadata('Kept organism'));
  assert.deepEqual(screen.fetches, []);
});

test('metadata refresh belongs to the editor and preserves unsaved labels', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {metadata: metadata('Stale')})]},
  });
  await ready(screen);
  await press(screen.input, 'm');
  await press(screen.input, 'c');
  assert.deepEqual(screen.fetches, []);
  assert.equal(screen.configurations, 0, 'provider setup is not a list action');
  await press(screen.input, ENTER);
  await press(screen.input, 'draft-marker');
  await press(screen.input, '\x1b[A');
  await press(screen.input, 'm');
  await waitFor(() => ncbiMetadata(screen.catalog.accessions[0]?.metadata)?.organism === 'Fetched organism', 'the refresh');
  await effectsSettled();
  assert.equal(screen.catalog.accessions[0]?.name, undefined, 'refresh does not save drafts');
  await press(screen.input, ENTER);
  await waitFor(() => screen.catalog.accessions[0]?.name === 'draft-marker', 'draft saved after refresh');
  assert.deepEqual(screen.deletions, []);
});

test('metadata refresh failures can be retried and an active lookup can be cancelled in the editor', async context => {
  let signal: AbortSignal | undefined;
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {metadata: metadata('unchanged-marker')})]},
    fetch: async (_id, abortSignal) => {
      if (screen.fetches.length === 1) {
        return {state: 'failed', kind: 'offline', message: 'failure-marker'};
      }
      signal = abortSignal;
      return new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason), {once: true}));
    },
  });
  await ready(screen);
  await press(screen.input, ENTER);
  await press(screen.input, '\x1b[A');
  await press(screen.input, 'm');
  await waitForOutput(screen.output, value => value.includes('failure-marker'));
  await press(screen.input, 'm');
  await waitFor(() => signal !== undefined, 'retry starts lookup');
  await press(screen.input, ESCAPE);
  await waitFor(() => signal!.aborted, 'lookup cancelled');
  await effectsSettled();
  assert.equal(ncbiMetadata(screen.catalog.accessions[0]?.metadata)?.organism, 'unchanged-marker');
  assert.equal(screen.backs, 0);
  await press(screen.input, ESCAPE);
  await press(screen.input, ESCAPE);
  assert.equal(screen.backs, 1);
});

test('removing a cached entry deletes its cache directories under every known root', async context => {
  const screen = renderScreen(context, {
    catalog: {
      ...emptyAccessionCatalog(),
      output_roots: ['/analysis/other'],
      accessions: [entry(accession, {metadata: metadata('Organism')})],
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
  await press(screen.input, '/analysis/other');
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
    catalog: {...emptyAccessionCatalog(), accessions: [entry(accession, {name: 'A long researcher label', metadata: metadata('Organism')})]},
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
  await press(screen.input, '/analysis/other');
  await waitForOutput(screen.output, value => value.includes('/analysis/other'));
  await addTypedRoot(screen.input);
  await waitFor(() => screen.catalog.output_roots.length === 1, 'the root added on the roots tab');
  // Adding a root rescans; the tab takes keys again once the save and that scan are shown.
  await waitFor(() => screen.scansCompleted >= 2, 'the rescan after adding the root');
  await effectsSettled();

  // ← from the roots tab returns to the accession list, whose n opens the add form.
  await press(screen.input, ARROW_LEFT);
  await press(screen.input, 'n');
  await press(screen.input, ENTER);
  await settle();
  await press(screen.input, typed);
  await waitForOutput(screen.output, value => value.includes(typed));
  assert.equal(screen.fetches.length, 0);
});

test('shows every cached and damaged copy when an entry is opened', async context => {
  const screen = renderScreen(context, {
    catalog: {...emptyAccessionCatalog(), output_roots: ['/analysis/other'], accessions: [entry(accession, {metadata: metadata('Organism')})]},
    copies: [
      copy(accession, '/project/runs', 'verified'),
      copy(accession, '/analysis/other', 'checksum-invalid', 'genomic.fna does not match its recorded checksum'),
    ],
  });
  await waitFor(() => screen.writes === 1, 'discovery to record the verified copy');
  await ready(screen);

  screen.output.clear();
  await press(screen.input, ENTER);
  await press(screen.input, '\x1b[6~');

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
