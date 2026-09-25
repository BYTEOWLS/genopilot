import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {applyCacheScan, uniqueRoots, type CacheScan, type CacheScanner} from './cache-discovery.js';
import type {AccessionCatalog} from './catalog.js';
import {
  AccessionCatalogChangedError,
  type AccessionCatalogMutation,
  type LoadedAccessionCatalog,
} from './store.js';

export type AccessionCatalogLoader = () => Promise<LoadedAccessionCatalog>;
export type AccessionCatalogUpdater = (
  expectedRevision: string | undefined,
  mutate: AccessionCatalogMutation,
) => Promise<LoadedAccessionCatalog>;

/** The run collection of the current directory: always scanned, never stored. */
export function defaultOutputRoot(currentDirectory: string): string {
  return resolve(currentDirectory, 'runs');
}

/** Every output root discovery scans: the current directory's runs folder and the stored roots. */
export function knownOutputRoots(catalog: AccessionCatalog, currentDirectory: string): string[] {
  return uniqueRoots([defaultOutputRoot(currentDirectory), ...catalog.output_roots]);
}

/**
 * Scans output roots and records the result, saving only when it changes the catalog. With
 * `addRoot`, that output root is stored in the same write; with `onlyAddedRoot`, only that root is
 * scanned and copies recorded under other roots are left alone, as after a run.
 *
 * Hashing can take a while, so the catalog is read again after the scan and the result merged
 * into that; if another window saves in between, the merge is retried once.
 */
export async function refreshAccessionCaches({
  currentDirectory,
  loadCatalog,
  updateCatalog,
  scanCaches,
  addRoot,
  onlyAddedRoot = false,
}: {
  currentDirectory: string;
  loadCatalog: AccessionCatalogLoader;
  updateCatalog: AccessionCatalogUpdater;
  scanCaches: CacheScanner;
  addRoot?: string;
  onlyAddedRoot?: boolean;
}): Promise<{loaded: LoadedAccessionCatalog; scan: CacheScan}> {
  const withRoot = (catalog: AccessionCatalog): AccessionCatalog => {
    if (addRoot === undefined || catalog.output_roots.some(root => resolve(root) === resolve(addRoot))) {
      return catalog;
    }
    return {...catalog, output_roots: [...catalog.output_roots, resolve(addRoot)]};
  };
  const partial = onlyAddedRoot && addRoot !== undefined;
  const merge = (catalog: AccessionCatalog): AccessionCatalog =>
    applyCacheScan(withRoot(catalog), scan, {partial});

  const initial = await loadCatalog();
  const scan = await scanCaches(partial
    ? [resolve(addRoot)]
    : knownOutputRoots(withRoot(initial.catalog), currentDirectory));
  for (let attempt = 0; ; attempt += 1) {
    const latest = await loadCatalog();
    if (isDeepStrictEqual(merge(latest.catalog), latest.catalog)) {
      return {loaded: latest, scan};
    }
    try {
      return {loaded: await updateCatalog(latest.revision, merge), scan};
    } catch (error) {
      if (!(error instanceof AccessionCatalogChangedError) || attempt > 0) {
        throw error;
      }
    }
  }
}
