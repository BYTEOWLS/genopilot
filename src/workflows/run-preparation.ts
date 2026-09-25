import {availableParallelism} from 'node:os';
import {access, mkdir, readdir, readFile, rm, rmdir, stat, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {stringify} from 'yaml';
import {ncbiCacheDirectoryName} from '../accessions/catalog.js';
import {formatCompactUtcTimestamp} from './timestamps.js';
import type {ConfigurationValidationIssue, CpuMode} from './configuration-validation.js';

/** Preparing a new run's workspace, shared by every workflow's run configuration. */

export type PathInspection = (path: string) => Promise<{isFile(): boolean; isDirectory(): boolean}>;

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

const maximumRunIdSuffixLength = 60;

/** Formats the timestamp every run ID is always prefixed with, e.g. "2026-09-05_083412123_". */
export function formatRunTimestampPrefix(now: Date = new Date()): string {
  return `${formatCompactUtcTimestamp(now)}_`;
}

/**
 * Reduces a researcher-facing run label to a safe suffix for the run ID's directory name.
 * The label itself is stored verbatim in `run.name`; only this derived copy is sanitized.
 */
export function sanitizeRunIdSuffix(label: string): string {
  return label
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, maximumRunIdSuffixLength)
    .replace(/^[-._]+|[-._]+$/g, '');
}

/**
 * Builds the run's unique identifier, which is also its directory name: the timestamp prefix
 * guarantees uniqueness, and the sanitized label — or the workflow ID when no label was
 * entered — keeps run directories recognizable.
 */
export function buildRunId(label: string, workflowId: string, now: Date = new Date()): string {
  const suffix = sanitizeRunIdSuffix(label.trim());
  return `${formatRunTimestampPrefix(now)}${suffix || workflowId}`;
}

export function effectiveCpuCount(
  mode: CpuMode,
  manualLimit: string,
  availableCpus: number = availableParallelism(),
): number {
  const usableCpus = Math.max(1, availableCpus);
  switch (mode) {
    case 'automatic':
      return usableCpus;
    case 'leave-one-free':
      return Math.max(1, usableCpus - 1);
    case 'manual': {
      const requested = Number(manualLimit);
      return Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, usableCpus)
        : 0;
    }
  }
}

export function resolveDraftPath(currentDirectory: string, value: string): string {
  return value.length === 0 ? '' : resolve(currentDirectory, value);
}

/** Where a run's NCBI inputs are cached: beside, not inside, its run directories. */
export function ncbiCacheDirectory(outputRoot: string, accession: string): string {
  return resolve(outputRoot, ncbiCacheDirectoryName, accession);
}

/**
 * Whether the accession already has a cache entry under the output root. Throws a message when
 * the entry exists but cannot be used, so the researcher is never asked about an unusable cache.
 */
export async function hasNcbiCacheEntry(
  outputRoot: string,
  accession: string,
  inspectPath: PathInspection = stat,
): Promise<boolean> {
  const cacheDirectory = ncbiCacheDirectory(outputRoot, accession);
  let details;
  try {
    details = await inspectPath(cacheDirectory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw new Error(`cache entry cannot be accessed: ${cacheDirectory}`);
  }
  if (!details.isDirectory()) {
    throw new Error(`cache entry must be a directory: ${cacheDirectory}`);
  }
  if (inspectPath === stat) {
    try {
      await access(cacheDirectory, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch {
      throw new Error(`cache entry must be readable and writable: ${cacheDirectory}`);
    }
  }
  return true;
}

/** Reports a local input that is not a readable file. */
export async function checkReadableFile(
  path: string,
  issuePath: string,
  issues: ConfigurationValidationIssue[],
  inspectPath: PathInspection = stat,
): Promise<void> {
  try {
    const details = await inspectPath(path);
    if (!details.isFile()) {
      issues.push({path: issuePath, message: 'must identify a readable file'});
    } else if (inspectPath === stat) {
      await access(path, constants.R_OK);
    }
  } catch {
    issues.push({path: issuePath, message: 'must identify a readable file'});
  }
}

/** Reports an unusable output root or a run directory that already exists. */
export async function checkRunDestination(
  outputRoot: string,
  outputDirectory: string,
  issues: ConfigurationValidationIssue[],
  inspectPath: PathInspection = stat,
): Promise<void> {
  try {
    const details = await inspectPath(outputRoot);
    if (!details.isDirectory()) {
      issues.push({path: '$.run.output_root', message: 'must identify a writable directory'});
    } else if (inspectPath === stat) {
      await access(outputRoot, constants.W_OK);
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      issues.push({path: '$.run.output_root', message: 'must identify a writable directory'});
    }
  }
  try {
    await inspectPath(outputDirectory);
    issues.push({path: '$.run.id', message: 'already exists in the selected output root'});
  } catch {
    // A missing run directory is required for a new run.
  }
}

/**
 * Serializes a run file for Snakemake, which reads YAML with a 1.1 loader that turns unquoted
 * timestamps and words like `no` into non-string values; every string is therefore quoted.
 */
export function stringifyRunFile(value: unknown): string {
  return stringify(value, {defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN'});
}

/**
 * Creates a new, never-overwritten run directory holding the given files, written privately in
 * order. If any step fails, everything written so far is removed again, so no half-written run
 * is left behind. Returns the path of each file by name.
 */
export async function createRunWorkspace(
  outputDirectory: string,
  files: readonly {name: string; content: string}[],
  alreadyExists: () => Error,
): Promise<Record<string, string>> {
  await mkdir(dirname(outputDirectory), {recursive: true, mode: 0o700});
  try {
    await mkdir(outputDirectory, {mode: 0o700});
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw alreadyExists();
    }
    throw error;
  }
  const written: Record<string, string> = {};
  try {
    for (const file of files) {
      const path = resolve(outputDirectory, file.name);
      await writeFile(path, file.content, {encoding: 'utf8', flag: 'wx', mode: 0o600});
      written[file.name] = path;
    }
  } catch (error) {
    for (const path of Object.values(written)) {
      await rm(path, {force: true}).catch(() => undefined);
    }
    await rmdir(outputDirectory).catch(() => undefined);
    throw error;
  }
  return written;
}

export type SavedRunRecord<C> = {directory: string; configuration: C};

/**
 * Reads every saved run of one workflow under `outputRoot`, newest first, so a new-run form can
 * offer them as prefill history. A run directory with a missing or invalid config.yaml is
 * skipped rather than failing discovery for every other run.
 */
export async function discoverSavedRuns<C extends {run: {created_at: string}}>(
  outputRoot: string,
  workflowId: string,
  parseConfiguration: (source: string) => C,
): Promise<SavedRunRecord<C>[]> {
  const workflowDirectory = resolve(outputRoot, workflowId);
  let entries;
  try {
    entries = await readdir(workflowDirectory, {withFileTypes: true});
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const records: SavedRunRecord<C>[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = resolve(workflowDirectory, entry.name);
    try {
      const source = await readFile(resolve(directory, 'config.yaml'), 'utf8');
      records.push({directory, configuration: parseConfiguration(source)});
    } catch {
      // Skip a run whose configuration is missing or no longer valid.
    }
  }
  records.sort((left, right) =>
    right.configuration.run.created_at.localeCompare(left.configuration.run.created_at),
  );
  return records;
}
