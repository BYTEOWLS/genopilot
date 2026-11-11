import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {parse} from 'yaml';
import {isRecord} from '../workflows/configuration-validation.js';
import {recordedArtifacts} from '../workflows/artifact-index.js';
import type {WorkflowManifest} from '../workflows/manifest.js';
import {recordFileName, rewriteFolderPrefix, type RewriteRecord} from './job.js';

/** The folder of a run that holds files derived from its results, outside `results/`. */
export const derivedFolderName = 'derived';

async function isRunDirectory(directory: string): Promise<boolean> {
  try {
    const configuration: unknown = parse(await readFile(join(directory, 'config.yaml'), 'utf8'));
    return isRecord(configuration) && typeof configuration.workflow_id === 'string' &&
      isRecord(configuration.run) && typeof configuration.run.id === 'string';
  } catch {
    return false;
  }
}

/** The run a file lies in, found by its saved configuration in a folder above it; none outside a run. */
export async function findRunDirectory(path: string): Promise<string | undefined> {
  let directory = dirname(resolve(path));
  while (true) {
    if (await isRunDirectory(directory)) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/** Where a rewrite of `source` goes by default: the run's `derived/`, else next to the source. */
export function defaultOutputParent(source: string, runDirectory: string | undefined): string {
  return runDirectory ? join(runDirectory, derivedFolderName) : dirname(resolve(source));
}

export type DerivedRewrite = {
  /** The folder name, such as `gff3-replace-20261111T231405.123Z`. */
  name: string;
  folder: string;
  record?: RewriteRecord;
  /** The rewritten GFF3, when its record names one. */
  gff3?: string;
  /** `outdated` when the source's recorded checksum no longer matches; `unreadable` without a valid record. */
  state: 'current' | 'outdated' | 'unreadable';
  reason?: string;
};

function readRecord(value: unknown): RewriteRecord | undefined {
  if (!isRecord(value) || value.schema_version !== 1 || !isRecord(value.source) || typeof value.source.sha256 !== 'string' ||
      !isRecord(value.files) || !isRecord(value.files.gff3) || typeof value.files.gff3.path !== 'string' ||
      typeof value.files.gff3.sha256 !== 'string' || typeof value.search !== 'string' || typeof value.replacement !== 'string') {
    return undefined;
  }
  return value as RewriteRecord;
}

/**
 * The rewrites in a run's `derived/`, oldest first. A rewrite is outdated when its source's checksum
 * differs from the one recorded for that source now: in the run's `artifacts.yaml`, or in the record
 * of the earlier rewrite it was made from, which must itself be current. Nothing is re-hashed.
 */
export async function listDerivedRewrites(runDirectory: string): Promise<DerivedRewrite[]> {
  const derived = join(resolve(runDirectory), derivedFolderName);
  let names: string[];
  try {
    names = (await readdir(derived, {withFileTypes: true}))
      .filter(entry => entry.isDirectory() && entry.name.startsWith(rewriteFolderPrefix))
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
  const rewrites = new Map<string, DerivedRewrite>();
  for (const name of names) {
    const folder = join(derived, name);
    let record: RewriteRecord | undefined;
    try {
      record = readRecord(parse(await readFile(join(folder, recordFileName), 'utf8')));
    } catch {
      record = undefined;
    }
    rewrites.set(name, record
      ? {name, folder, record, gff3: join(folder, record.files.gff3.path), state: 'current'}
      : {name, folder, state: 'unreadable', reason: `${recordFileName} is missing or not readable`});
  }
  let artifacts: Awaited<ReturnType<typeof recordedArtifacts>> | undefined;
  const runArtifacts = async (): Promise<typeof artifacts> => {
    if (!artifacts) {
      try {
        artifacts = await recordedArtifacts(runDirectory);
      } catch {
        artifacts = new Map();
      }
    }
    return artifacts;
  };
  const settled = new Set<string>();
  const settle = async (rewrite: DerivedRewrite): Promise<void> => {
    if (settled.has(rewrite.name) || !rewrite.record) {
      return;
    }
    settled.add(rewrite.name);
    const source = rewrite.record.source;
    const runPath = source.run_path?.split(sep).join('/');
    if (!runPath) {
      Object.assign(rewrite, {state: 'outdated', reason: 'the source is not a file of this run'});
      return;
    }
    const [first, second, ...rest] = runPath.split('/');
    if (first === derivedFolderName && second && rest.length > 0) {
      const parent = rewrites.get(second);
      if (!parent?.record) {
        Object.assign(rewrite, {state: 'outdated', reason: `its source rewrite ${second} is missing`});
        return;
      }
      await settle(parent);
      if (parent.state !== 'current') {
        Object.assign(rewrite, {state: 'outdated', reason: `its source rewrite ${second} is outdated`});
      } else if (parent.record.files.gff3.path !== rest.join('/') || parent.record.files.gff3.sha256 !== source.sha256) {
        Object.assign(rewrite, {state: 'outdated', reason: `its source no longer matches ${second}`});
      }
      return;
    }
    const recorded = (await runArtifacts())!.get(runPath);
    if (!recorded) {
      Object.assign(rewrite, {state: 'outdated', reason: `the run's artifact index no longer records ${runPath}`});
    } else if (recorded.sha256 !== source.sha256) {
      Object.assign(rewrite, {state: 'outdated', reason: `${runPath} changed since the rewrite`});
    }
  };
  for (const rewrite of rewrites.values()) {
    await settle(rewrite);
  }
  return [...rewrites.values()];
}

export type Gff3Source = {
  /** A stable ID: the manifest artifact's ID, or the rewrite folder's name. */
  id: string;
  label: string;
  path: string;
  kind: 'artifact' | 'derived';
};

/** A finished run's GFF3 files to start a rewrite from: its `gff3` artifacts that exist, then its current rewrites. */
export function runGff3Sources(
  runDirectory: string,
  manifest: Pick<WorkflowManifest, 'artifacts'>,
  rewrites: readonly DerivedRewrite[],
  pathExists: (path: string) => boolean = existsSync,
): Gff3Source[] {
  const directory = resolve(runDirectory);
  return [
    ...manifest.artifacts
      .filter(artifact => artifact.type === 'gff3' && pathExists(resolve(directory, artifact.path)))
      .map(artifact => ({id: artifact.id, label: artifact.label, path: resolve(directory, artifact.path), kind: 'artifact' as const})),
    ...rewrites
      .filter(rewrite => rewrite.state === 'current' && rewrite.gff3 && pathExists(rewrite.gff3))
      .map(rewrite => ({id: rewrite.name, label: `Rewrite ${rewrite.name}`, path: rewrite.gff3!, kind: 'derived' as const})),
  ];
}
