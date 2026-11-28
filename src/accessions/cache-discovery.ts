import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, mkdir, readdir, readFile, realpath, rm, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {accessionSources} from './registry.js';
import {artifactFiles, fileKinds, referenceKey, type ArtifactDigests, type FileKind, type GenomeReference, type GenomeProviderRegistry} from './provider.js';
import {
  type AccessionCatalog,
  type AccessionEntry,
  type CachedCopy,
} from './catalog.js';


// Fixed names shared by the cache writer and workflow resolver.
const checksumsFileName = 'checksums.json';

export type ScannedCopyState = 'verified' | 'incomplete' | 'checksum-invalid';

export type ScannedCopy = GenomeReference & ArtifactDigests & {
  /** The output root the copy was found in; a directory reached through two roots counts once. */
  root: string;
  /** Canonical directory path, so one directory reached through two roots is listed once. */
  path: string;
  state: ScannedCopyState;
  /** Why an unverified copy is not trusted. */
  problem?: string;
  metadata: unknown;
};

export type IgnoredCacheEntry = {path: string; reason: string};

export type CacheScan = {
  scannedAt: string;
  /** Canonical cache directories this scan read, or would have read had they existed. */
  cacheDirectories: string[];
  copies: ScannedCopy[];
  /** Entries in a cache that are neither verified nor damaged copies, with the reason. */
  ignored: IgnoredCacheEntry[];
  /** Roots whose cache directory exists but cannot be read. */
  rootProblems: {root: string; message: string}[];
};

/** A scan that has not read anything yet, e.g. while the first one is still running. */
export function emptyCacheScan(): CacheScan {
  return {scannedAt: '', cacheDirectories: [], copies: [], ignored: [], rootProblems: []};
}

export type CacheScanner = (roots: readonly string[]) => Promise<CacheScan>;

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash, {signal});
  return hash.digest('hex');
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

const sha256Pattern = /^[0-9a-f]{64}$/;

async function readRecordedChecksums(
  directory: string,
  kinds?: readonly FileKind[],
): Promise<Partial<Record<FileKind, string>> | string> {
  let source: string;
  try {
    source = await readFile(join(directory, checksumsFileName), 'utf8');
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? `${checksumsFileName} is missing`
      : `${checksumsFileName} cannot be read: ${errorMessage(error)}`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return `${checksumsFileName} is not valid JSON`;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return `${checksumsFileName} is not a checksum record`;
  }
  const values = parsed as Partial<Record<FileKind, unknown>>;
  if (Object.keys(values).some(kind => !fileKinds.includes(kind as FileKind))) {
    return `${checksumsFileName} records an unknown artifact`;
  }
  if (!fileKinds.some(kind => values[kind] !== undefined)) {
    return `${checksumsFileName} records no artifacts`;
  }
  const selected: Partial<Record<FileKind, string>> = {};
  for (const kind of kinds ?? fileKinds) {
    const value = values[kind];
    if (value === undefined) {
      if (kind !== 'gff3' && kinds?.includes(kind)) {
        return `${checksumsFileName} records no ${kind === 'fasta' ? 'FASTA' : kind} checksum`;
      }
      continue;
    }
    if (typeof value !== 'string' || !sha256Pattern.test(value)) {
      return `${checksumsFileName} records an invalid ${kind === 'fasta' ? 'FASTA' : 'GFF3'} checksum`;
    }
    selected[kind] = value;
  }
  return selected;
}

/** Verify requested files; catalog discovery checks every recorded file by default. */
export async function inspectCopy(
  reference: GenomeReference,
  root: string,
  directory: string,
  metadata: unknown = null,
  {signal, kinds}: {signal?: AbortSignal; kinds?: readonly FileKind[]} = {},
): Promise<ScannedCopy> {
  signal?.throwIfAborted();
  const base = {...reference, root, path: directory, metadata};
  const recorded = await readRecordedChecksums(directory, kinds);
  if (typeof recorded === 'string') {
    return {...base, state: 'incomplete', problem: recorded};
  }
  const files = fileKinds.filter(kind => recorded[kind]).map(kind => ({name: artifactFiles[kind], expected: recorded[kind]!}));
  for (const file of files) {
    const path = join(directory, file.name);
    if (!(await isFile(path))) {
      return {...base, state: 'incomplete', problem: `${file.name} is missing`};
    }
    if ((await sha256File(path, signal)) !== file.expected) {
      return {...base, state: 'checksum-invalid', problem: `${file.name} does not match its recorded checksum`};
    }
  }
  return {...base, state: 'verified', ...Object.fromEntries(fileKinds.filter(kind => recorded[kind]).map(kind => [`${kind}_sha256`, recorded[kind]]))};
}

/** Removes repeated roots while keeping their order. */
export function uniqueRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map(root => resolve(root)))];
}

/**
 * Reads registered provider caches directly inside the output roots. Discovery never
 * contacts providers and never changes or deletes files.
 */
export async function scanAccessionCaches(
  roots: readonly string[],
  now: () => Date = () => new Date(),
  registry: GenomeProviderRegistry = accessionSources,
): Promise<CacheScan> {
  const scan: CacheScan = {scannedAt: now().toISOString(), cacheDirectories: [], copies: [], ignored: [], rootProblems: []};
  const seen = new Set<string>();
  for (const root of uniqueRoots(roots)) {
    for (const provider of registry.list()) {
      const cacheDirectory = join(root, provider.cacheDirectory);
      scan.cacheDirectories.push(await realpath(cacheDirectory).catch(() => cacheDirectory));
      let entries;
      try {
        entries = await readdir(cacheDirectory, {withFileTypes: true});
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          scan.rootProblems.push({root, message: errorMessage(error)});
        }
        continue;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const directory = join(cacheDirectory, entry.name);
        if (entry.isSymbolicLink()) {
          scan.ignored.push({path: directory, reason: 'is a symbolic link, which is not followed'});
          continue;
        }
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }
        try {
          const record: unknown = JSON.parse(await readFile(join(directory, 'genome.json'), 'utf8'));
          if (typeof record !== 'object' || record === null || !('reference' in record) || !('metadata' in record)) {
            throw new Error('Missing genome cache record.');
          }
          const reference = registry.validateReference(record.reference);
          if (reference.source !== provider.id || reference.id !== entry.name) {
            throw new Error('Cache identity does not match its directory.');
          }
          provider.validateMetadata(record.metadata);
          const canonical = await realpath(directory);
          if (seen.has(canonical)) {
            continue;
          }
          seen.add(canonical);
          scan.copies.push(await inspectCopy(reference, root, canonical, record.metadata));
        } catch (error) {
          scan.ignored.push({path: directory, reason: errorMessage(error)});
        }
      }
    }
  }
  return scan;
}

function sameCopy(left: CachedCopy, right: CachedCopy): boolean {
  return left.path === right.path && fileKinds.every(kind => left[`${kind}_sha256`] === right[`${kind}_sha256`]);
}

/**
 * Records the verified copies of the latest scan. Every entry's `cached_copies` becomes exactly
 * what was verified, so damaged, deleted, or no longer scanned copies are dropped; a `partial`
 * scan only replaces copies inside the cache directories it read. A copy that is unchanged keeps
 * its first `verified_at`. Entries found only on disk use their provider's saved metadata,
 * which never replaces metadata already recorded.
 */
export function applyCacheScan(
  catalog: AccessionCatalog,
  scan: CacheScan,
  {partial = false}: {partial?: boolean} = {},
): AccessionCatalog {
  const outsideScan = (copy: CachedCopy): boolean =>
    partial && !scan.cacheDirectories.some(directory => dirname(copy.path) === directory);
  const verified = new Map<string, ScannedCopy[]>();
  for (const copy of scan.copies) {
    if (copy.state === 'verified') {
      const key = referenceKey(copy);
      verified.set(key, [...(verified.get(key) ?? []), copy]);
    }
  }
  const copiesFor = (entry: AccessionEntry | undefined, key: string): CachedCopy[] =>
    (verified.get(key) ?? []).map(copy => {
      const next: CachedCopy = {
        path: copy.path, verified_at: scan.scannedAt,
        ...Object.fromEntries(fileKinds.filter(kind => copy[`${kind}_sha256`]).map(kind => [`${kind}_sha256`, copy[`${kind}_sha256`]])),
      };
      return entry?.cached_copies.find(previous => sameCopy(previous, next)) ?? next;
    }).concat(entry?.cached_copies.filter(outsideScan) ?? [])
      .sort((left, right) => left.path.localeCompare(right.path));

  const accessions: AccessionEntry[] = catalog.accessions.map(entry => ({
    ...entry,
    metadata: entry.metadata ?? verified.get(referenceKey(entry))?.[0]?.metadata ?? null,
    cached_copies: copiesFor(entry, referenceKey(entry)),
  }));
  const known = new Set(catalog.accessions.map(referenceKey));
  for (const [key, copies] of verified) {
    if (!known.has(key)) {
      const copy = copies[0]!;
      accessions.push({
        source: copy.source, id: copy.id, parameters: copy.parameters,
        metadata: copy.metadata, cached_copies: copiesFor(undefined, key),
      });
    }
  }
  return {...catalog, accessions};
}

/** Delete only this provider/ID, refusing symlinks and path traversal. */
export async function deleteAccessionCaches(
  roots: readonly string[],
  reference: GenomeReference,
  registry: GenomeProviderRegistry = accessionSources,
): Promise<string[]> {
  const validated = registry.validateReference(reference);
  const provider = registry.get(validated.source);
  const deleted: string[] = [];
  const seen = new Set<string>();
  for (const root of uniqueRoots(roots)) {
    const cacheDirectory = join(root, provider.cacheDirectory);
    const directory = join(cacheDirectory, validated.id);
    let details;
    try {
      details = await lstat(directory);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Refusing to delete ${directory}: it is not a directory.`);
    }
    const [canonicalCache, canonicalDirectory] = await Promise.all([realpath(cacheDirectory), realpath(directory)]);
    if (canonicalDirectory !== join(canonicalCache, validated.id)) {
      throw new Error('Refusing to delete outside the provider cache.');
    }
    if (!seen.has(canonicalDirectory)) {
      seen.add(canonicalDirectory);
      const lock = join(canonicalCache, `.${validated.id}.lock`);
      try {
        await mkdir(lock);
      } catch {
        throw new Error('Another genome cache writer holds this entry. Retry after it finishes.');
      }
      try {
        await rm(canonicalDirectory, {recursive: true});
        deleted.push(canonicalDirectory);
      } finally {
        await rm(lock, {recursive: true, force: true});
      }
    }
  }
  return deleted;
}

export type AccessionCacheDeleter = typeof deleteAccessionCaches;
