import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {stringify} from 'yaml';
import {acquireFileLock} from './file-lock.js';

export type LoadedCatalog<C> = {
  catalog: C;
  /** Checksum of the file the catalog was read from; undefined when no file exists yet. */
  revision: string | undefined;
};

export type CatalogMutation<C> = (catalog: C) => C;

export type CatalogStore<C> = {
  load: (path: string) => Promise<LoadedCatalog<C>>;
  /**
   * Applies `mutate` to the catalog under an exclusive lock and replaces the file atomically. The
   * edit is refused when the file no longer matches `expectedRevision`, so two application
   * instances cannot silently overwrite each other's changes.
   */
  update: (
    path: string,
    expectedRevision: string | undefined,
    mutate: CatalogMutation<C>,
  ) => Promise<LoadedCatalog<C>>;
};

function checksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function serializeCatalog(catalog: unknown): string {
  // Snakemake and other YAML 1.1 readers turn unquoted words like `no` into booleans; quote every
  // string so names and paths always round-trip as strings.
  return stringify(catalog, {defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN'});
}

/**
 * A private, user-local YAML catalog file. A file that fails to parse or validate is reported
 * through `loadError` and never overwritten.
 */
export function createCatalogStore<C>({
  parse,
  validate,
  empty,
  loadError,
  changedError,
  busyMessage,
}: {
  parse: (source: string) => C;
  validate: (value: unknown) => C;
  empty: () => C;
  loadError: (path: string, cause: unknown) => Error;
  changedError: () => Error;
  busyMessage: string;
}): CatalogStore<C> {
  const readSource = async (path: string): Promise<string | undefined> => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw loadError(path, error);
    }
  };

  const parseSource = (path: string, source: string | undefined): LoadedCatalog<C> => {
    if (source === undefined) {
      return {catalog: empty(), revision: undefined};
    }
    try {
      return {catalog: parse(source), revision: checksum(source)};
    } catch (error) {
      throw loadError(path, error);
    }
  };

  return {
    load: async path => parseSource(path, await readSource(path)),
    update: async (path, expectedRevision, mutate) => {
      const directory = dirname(path);
      await mkdir(directory, {recursive: true, mode: 0o700});
      await chmod(directory, 0o700);
      const lock = await acquireFileLock(`${path}.lock`, busyMessage);
      try {
        const current = parseSource(path, await readSource(path));
        if (current.revision !== expectedRevision) {
          throw changedError();
        }
        const next = validate(mutate(structuredClone(current.catalog)));
        const source = serializeCatalog(next);
        const temporaryPath = `${path}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporaryPath, 'wx', 0o600);
          try {
            await handle.writeFile(source, 'utf8');
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporaryPath, path);
        } catch (error) {
          await rm(temporaryPath, {force: true});
          throw error;
        }
        return {catalog: next, revision: checksum(source)};
      } finally {
        await lock.release();
      }
    },
  };
}
