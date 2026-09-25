import assert from 'node:assert/strict';
import test from 'node:test';
import type {CacheScan} from '../../src/accessions/cache-discovery.js';
import {emptyAccessionCatalog, type AccessionCatalog, type CachedCopy} from '../../src/accessions/catalog.js';
import {knownOutputRoots, refreshAccessionCaches} from '../../src/accessions/registration.js';
import {
  AccessionCatalogChangedError,
  type AccessionCatalogMutation,
  type LoadedAccessionCatalog,
} from '../../src/accessions/store.js';

const accession = 'GCF_000149205.2';

function copyPath(root: string): string {
  return `${root}/ncbi-accessions-cache/${accession}`;
}

/** A scanner that finds one verified copy of the accession in each root it reads. */
function scanWith(scanned: (readonly string[])[]) {
  return async (roots: readonly string[]): Promise<CacheScan> => {
    scanned.push(roots);
    return {
      scannedAt: '2026-01-01T12:00:00.000Z',
      cacheDirectories: roots.map(root => `${root}/ncbi-accessions-cache`),
      ignored: [],
      rootProblems: [],
      copies: roots.map(root => ({
        accession,
        root,
        path: copyPath(root),
        state: 'verified' as const,
        fasta_sha256: 'a'.repeat(64),
      })),
    };
  };
}

function fakeStore(initial: AccessionCatalog, {conflicts = 0}: {conflicts?: number} = {}) {
  let current: LoadedAccessionCatalog = {catalog: initial, revision: 'r0'};
  let writes = 0;
  let remainingConflicts = conflicts;
  return {
    get writes() {
      return writes;
    },
    get catalog() {
      return current.catalog;
    },
    load: async () => current,
    update: async (revision: string | undefined, mutate: AccessionCatalogMutation) => {
      if (remainingConflicts > 0) {
        remainingConflicts -= 1;
        // Another window saved in between: its change lands, and this write is refused.
        current = {catalog: {...current.catalog, output_roots: [...current.catalog.output_roots, '/other/window']}, revision: `${current.revision ?? ''}x`};
        throw new AccessionCatalogChangedError();
      }
      assert.equal(revision, current.revision);
      writes += 1;
      current = {catalog: mutate(structuredClone(current.catalog)), revision: `r${String(writes)}`};
      return current;
    },
  };
}

function recordedCopy(root: string): CachedCopy {
  return {path: copyPath(root), verified_at: '2025-01-01T00:00:00.000Z', fasta_sha256: 'a'.repeat(64)};
}

test('scans the current directory runs folder and stored roots without repeats', () => {
  const catalog = {...emptyAccessionCatalog(), output_roots: ['/project/runs', '/analysis/other']};

  assert.deepEqual(knownOutputRoots(catalog, '/project'), ['/project/runs', '/analysis/other']);
});

test('after a run, scans only its output root and keeps copies recorded elsewhere', async () => {
  const store = fakeStore({
    ...emptyAccessionCatalog(),
    output_roots: ['/analysis/earlier'],
    accessions: [{accession, ncbi: null, cached_copies: [recordedCopy('/analysis/earlier')]}],
  });
  const scanned: (readonly string[])[] = [];

  const {loaded} = await refreshAccessionCaches({
    currentDirectory: '/project',
    loadCatalog: store.load,
    updateCatalog: store.update,
    scanCaches: scanWith(scanned),
    addRoot: '/analysis/run/',
    onlyAddedRoot: true,
  });

  assert.deepEqual(scanned, [['/analysis/run']]);
  assert.equal(store.writes, 1);
  assert.deepEqual(loaded.catalog.output_roots, ['/analysis/earlier', '/analysis/run']);
  assert.deepEqual(
    loaded.catalog.accessions[0]?.cached_copies.map(copy => copy.path),
    [copyPath('/analysis/earlier'), copyPath('/analysis/run')],
  );
});

test('a full refresh drops copies under roots that are no longer known', async () => {
  const store = fakeStore({
    ...emptyAccessionCatalog(),
    accessions: [{accession, ncbi: null, cached_copies: [recordedCopy('/analysis/forgotten')]}],
  });

  const {loaded} = await refreshAccessionCaches({
    currentDirectory: '/project',
    loadCatalog: store.load,
    updateCatalog: store.update,
    scanCaches: scanWith([]),
  });

  assert.deepEqual(loaded.catalog.accessions[0]?.cached_copies.map(copy => copy.path), [copyPath('/project/runs')]);
});

test('merges into a catalog another window saved during the scan', async () => {
  const store = fakeStore(emptyAccessionCatalog(), {conflicts: 1});

  const {loaded} = await refreshAccessionCaches({
    currentDirectory: '/project',
    loadCatalog: store.load,
    updateCatalog: store.update,
    scanCaches: scanWith([]),
  });

  // The other window's change and this scan's copy both survive.
  assert.deepEqual(loaded.catalog.output_roots, ['/other/window']);
  assert.equal(loaded.catalog.accessions[0]?.cached_copies.length, 1);
});

test('gives up after a second conflicting save', async () => {
  const store = fakeStore(emptyAccessionCatalog(), {conflicts: 2});

  await assert.rejects(
    refreshAccessionCaches({
      currentDirectory: '/project',
      loadCatalog: store.load,
      updateCatalog: store.update,
      scanCaches: scanWith([]),
    }),
    AccessionCatalogChangedError,
  );
});

test('does not write when discovery changes nothing', async () => {
  const store = fakeStore({
    ...emptyAccessionCatalog(),
    accessions: [{accession, ncbi: null, cached_copies: [recordedCopy('/project/runs')]}],
  });
  await refreshAccessionCaches({
    currentDirectory: '/project',
    loadCatalog: store.load,
    updateCatalog: store.update,
    scanCaches: scanWith([]),
  });

  assert.equal(store.writes, 0);
});
