import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {stringify} from 'yaml';
import {acquireFileLock} from '../file-lock.js';
import {emptyIsolateCatalog, parseIsolateCatalog, validateIsolateCatalog, type IsolateCatalog} from './catalog.js';

export type LoadedIsolateCatalog = {
  catalog: IsolateCatalog;
  /** Checksum of the file the catalog was read from; undefined when no file exists yet. */
  revision: string | undefined;
};

export type IsolateCatalogMutation = (catalog: IsolateCatalog) => IsolateCatalog;

/** The catalog file exists but cannot be read or does not satisfy the schema. */
export class IsolateCatalogLoadError extends Error {
  readonly catalogPath: string;

  constructor(catalogPath: string, cause: unknown) {
    super(
      `The isolate catalog at ${catalogPath} cannot be loaded and will not be changed until it is ` +
        `fixed or moved aside.\n${cause instanceof Error ? cause.message : String(cause)}`,
      {cause},
    );
    this.name = 'IsolateCatalogLoadError';
    this.catalogPath = catalogPath;
  }
}

/** Another writer changed the catalog after it was loaded, so the edit was not applied. */
export class IsolateCatalogChangedError extends Error {
  constructor() {
    super('The isolate catalog was changed by another Genopilot window. Reload it and try again.');
    this.name = 'IsolateCatalogChangedError';
  }
}

function checksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readCatalogSource(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new IsolateCatalogLoadError(path, error);
  }
}

function parseCatalogSource(path: string, source: string | undefined): LoadedIsolateCatalog {
  if (source === undefined) {
    return {catalog: emptyIsolateCatalog(), revision: undefined};
  }
  try {
    return {catalog: parseIsolateCatalog(source), revision: checksum(source)};
  } catch (error) {
    throw new IsolateCatalogLoadError(path, error);
  }
}

export async function loadIsolateCatalog(path: string): Promise<LoadedIsolateCatalog> {
  return parseCatalogSource(path, await readCatalogSource(path));
}

function serializeCatalog(catalog: IsolateCatalog): string {
  // Snakemake and other YAML 1.1 readers turn unquoted words like `no` into booleans; quote every
  // string so names and paths always round-trip as strings.
  return stringify(catalog, {defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN'});
}

/**
 * Applies `mutate` to the catalog under an exclusive lock and replaces the file atomically. The
 * edit is refused when the file no longer matches `expectedRevision`, so two application
 * instances cannot silently overwrite each other's changes.
 */
export async function updateIsolateCatalog(
  path: string,
  expectedRevision: string | undefined,
  mutate: IsolateCatalogMutation,
): Promise<LoadedIsolateCatalog> {
  const directory = dirname(path);
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  const lock = await acquireFileLock(
    `${path}.lock`,
    'Another Genopilot window is saving the isolate catalog. Try again.',
  );
  try {
    const current = parseCatalogSource(path, await readCatalogSource(path));
    if (current.revision !== expectedRevision) {
      throw new IsolateCatalogChangedError();
    }
    const next = validateIsolateCatalog(mutate(structuredClone(current.catalog)));
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
}
