import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, readdir, readFile, realpath, rm, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {isVersionedAssemblyAccession} from './accession.js';
import {
  ncbiCacheDirectoryName,
  type AccessionCatalog,
  type AccessionEntry,
  type CachedCopy,
  type NcbiAssemblyMetadata,
} from './catalog.js';
import {parseAssemblyReport} from './ncbi-metadata.js';

// The file names the workflow resolver (`workflows/shared/scripts/resolve_input.py`) writes into
// every accession cache directory.
const checksumsFileName = 'checksums.json';
const fastaFileName = 'genomic.fna';
const gff3FileName = 'genomic.gff';
const reportPath = ['ncbi_dataset', 'data', 'assembly_data_report.jsonl'] as const;

export type ScannedCopyState = 'verified' | 'incomplete' | 'checksum-invalid';

export type ScannedCopy = {
  accession: string;
  /** The output root the copy was found in; a directory reached through two roots counts once. */
  root: string;
  /** Canonical directory path, so one directory reached through two roots is listed once. */
  path: string;
  state: ScannedCopyState;
  /** Why an unverified copy is not trusted. */
  problem?: string;
  fasta_sha256?: string;
  gff3_sha256?: string;
  /** Metadata from the download's own NCBI report, when present. */
  report?: NcbiAssemblyMetadata;
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

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
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
): Promise<{fasta: string; gff3?: string} | string> {
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
  const {fasta, gff3} = parsed as {fasta?: unknown; gff3?: unknown};
  if (typeof fasta !== 'string' || !sha256Pattern.test(fasta)) {
    return `${checksumsFileName} records no FASTA checksum`;
  }
  if (gff3 !== undefined && (typeof gff3 !== 'string' || !sha256Pattern.test(gff3))) {
    return `${checksumsFileName} records an invalid GFF3 checksum`;
  }
  return typeof gff3 === 'string' ? {fasta, gff3} : {fasta};
}

async function readCachedReport(directory: string, accession: string): Promise<NcbiAssemblyMetadata | undefined> {
  const path = join(directory, ...reportPath);
  try {
    const [source, details] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    // The Datasets CLI writes one report per line, but a report reformatted for reading spans
    // many lines; accept the whole file as one report as well.
    const reports: unknown[] = [];
    try {
      reports.push(JSON.parse(source));
    } catch {
      for (const line of source.split('\n')) {
        try {
          reports.push(JSON.parse(line));
        } catch {
          // Blank or unparsable lines carry no report.
        }
      }
    }
    for (const report of reports) {
      // The report was written when the download was unpacked; that is when NCBI provided it.
      const metadata = parseAssemblyReport(report, accession, 'cached-download-report', details.mtime.toISOString());
      if (metadata) {
        return metadata;
      }
    }
  } catch {
    // The report is a convenience; its absence never affects whether the copy is trusted.
  }
  return undefined;
}

/** Verifies one accession cache directory against the checksums its resolver recorded. */
async function inspectCopy(accession: string, root: string, directory: string): Promise<ScannedCopy> {
  const report = await readCachedReport(directory, accession);
  const base = {accession, root, path: directory, ...(report ? {report} : {})};
  const recorded = await readRecordedChecksums(directory);
  if (typeof recorded === 'string') {
    return {...base, state: 'incomplete', problem: recorded};
  }
  const files = [
    {name: fastaFileName, expected: recorded.fasta},
    ...(recorded.gff3 ? [{name: gff3FileName, expected: recorded.gff3}] : []),
  ];
  for (const file of files) {
    const path = join(directory, file.name);
    if (!(await isFile(path))) {
      return {...base, state: 'incomplete', problem: `${file.name} is missing`};
    }
    if ((await sha256File(path)) !== file.expected) {
      return {...base, state: 'checksum-invalid', problem: `${file.name} does not match its recorded checksum`};
    }
  }
  return {
    ...base,
    state: 'verified',
    fasta_sha256: recorded.fasta,
    ...(recorded.gff3 ? {gff3_sha256: recorded.gff3} : {}),
  };
}

/** Removes repeated roots while keeping their order. */
export function uniqueRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map(root => resolve(root)))];
}

/**
 * Reads the NCBI caches directly inside the given output roots, and nothing else. Discovery never
 * contacts NCBI and never changes or deletes files.
 */
export async function scanAccessionCaches(
  roots: readonly string[],
  now: () => Date = () => new Date(),
): Promise<CacheScan> {
  const scan: CacheScan = {
    scannedAt: now().toISOString(),
    cacheDirectories: [],
    copies: [],
    ignored: [],
    rootProblems: [],
  };
  const seen = new Set<string>();
  for (const root of uniqueRoots(roots)) {
    const cacheDirectory = join(root, ncbiCacheDirectoryName);
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
        // Deletion refuses links, so discovery does not follow them either.
        scan.ignored.push({path: directory, reason: 'is a symbolic link, which is not followed'});
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (!isVersionedAssemblyAccession(entry.name)) {
        scan.ignored.push({path: directory, reason: 'is not named like a versioned assembly accession'});
        continue;
      }
      try {
        const canonical = await realpath(directory);
        if (seen.has(canonical)) {
          continue;
        }
        seen.add(canonical);
        scan.copies.push(await inspectCopy(entry.name, root, canonical));
      } catch (error) {
        // One unreadable copy must not hide the others; it is shown as damaged instead.
        scan.copies.push({
          accession: entry.name,
          root,
          path: directory,
          state: 'incomplete',
          problem: `cannot be read: ${errorMessage(error)}`,
        });
      }
    }
  }
  return scan;
}

function sameCopy(left: CachedCopy, right: CachedCopy): boolean {
  return left.path === right.path && left.fasta_sha256 === right.fasta_sha256 && left.gff3_sha256 === right.gff3_sha256;
}

/**
 * Records the verified copies of the latest scan. Every entry's `cached_copies` becomes exactly
 * what was verified, so damaged, deleted, or no longer scanned copies are dropped; a `partial`
 * scan only replaces copies inside the cache directories it read. A copy that is unchanged keeps
 * its first `verified_at`. Accessions found only on disk are added with the
 * metadata of their cached report, which never replaces metadata already recorded.
 */
export function applyCacheScan(
  catalog: AccessionCatalog,
  scan: CacheScan,
  {partial = false}: {partial?: boolean} = {},
): AccessionCatalog {
  // A partial scan read only some roots, so copies recorded outside its cache directories stay.
  const outsideScan = (copy: CachedCopy): boolean =>
    partial && !scan.cacheDirectories.some(directory => dirname(copy.path) === directory);
  const verified = new Map<string, ScannedCopy[]>();
  for (const copy of scan.copies) {
    if (copy.state === 'verified') {
      verified.set(copy.accession, [...(verified.get(copy.accession) ?? []), copy]);
    }
  }
  const copiesFor = (entry: AccessionEntry | undefined, accession: string): CachedCopy[] =>
    (verified.get(accession) ?? [])
      .map(copy => {
        const next: CachedCopy = {
          path: copy.path,
          verified_at: scan.scannedAt,
          fasta_sha256: copy.fasta_sha256 ?? '',
          ...(copy.gff3_sha256 ? {gff3_sha256: copy.gff3_sha256} : {}),
        };
        return entry?.cached_copies.find(previous => sameCopy(previous, next)) ?? next;
      })
      .concat(entry?.cached_copies.filter(outsideScan) ?? [])
      .sort((left, right) => left.path.localeCompare(right.path));
  const reportFor = (accession: string): NcbiAssemblyMetadata | null =>
    verified.get(accession)?.find(copy => copy.report)?.report ?? null;

  const accessions = catalog.accessions.map(entry => ({
    ...entry,
    ncbi: entry.ncbi ?? reportFor(entry.accession),
    cached_copies: copiesFor(entry, entry.accession),
  }));
  const known = new Set(catalog.accessions.map(entry => entry.accession));
  for (const accession of [...verified.keys()].sort()) {
    if (!known.has(accession)) {
      accessions.push({accession, ncbi: reportFor(accession), cached_copies: copiesFor(undefined, accession)});
    }
  }
  return {...catalog, accessions};
}

/**
 * Deletes every cache directory of `accession` directly inside the given roots, damaged or not,
 * and returns the deleted paths. A symbolic link, or a directory that does not resolve to exactly
 * `<root>/ncbi-accessions-cache/<accession>`, is refused rather than followed.
 */
export async function deleteAccessionCaches(roots: readonly string[], accession: string): Promise<string[]> {
  if (!isVersionedAssemblyAccession(accession)) {
    throw new Error(`Refusing to delete a cache for the invalid accession ${accession}.`);
  }
  const deleted: string[] = [];
  const seen = new Set<string>();
  for (const root of uniqueRoots(roots)) {
    const cacheDirectory = join(root, ncbiCacheDirectoryName);
    const directory = join(cacheDirectory, accession);
    let details;
    try {
      details = await lstat(directory);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!details.isDirectory()) {
      throw new Error(`Refusing to delete ${directory}: it is not a directory.`);
    }
    const [canonicalCache, canonicalDirectory] = await Promise.all([realpath(cacheDirectory), realpath(directory)]);
    if (canonicalDirectory !== join(canonicalCache, accession)) {
      throw new Error(`Refusing to delete ${directory}: it resolves outside its accession cache.`);
    }
    if (seen.has(canonicalDirectory)) {
      continue;
    }
    seen.add(canonicalDirectory);
    await rm(canonicalDirectory, {recursive: true});
    deleted.push(canonicalDirectory);
  }
  return deleted;
}

export type AccessionCacheDeleter = typeof deleteAccessionCaches;
