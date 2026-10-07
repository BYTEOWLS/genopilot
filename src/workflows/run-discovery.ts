import {readdir, readFile, realpath, rm} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {parse} from 'yaml';
import {validateGenoPilot, type GenoPilotDetails} from './configuration-validation.js';
import type {WorkflowManifest} from './manifest.js';
import {loadWorkflowResult, type LoadedWorkflowResult} from './results.js';

export type ExistingRunMetadata = {
  id: string;
  name?: string;
  description?: string;
  workflowId: string;
  workflowVersion: number;
  createdAt?: string;
  /** The GenoPilot that saved the run's configuration. */
  genopilot?: GenoPilotDetails;
};

export type ExistingRunStatus =
  | 'completed'
  | 'completed-with-warnings'
  | 'validation-failed'
  | 'incomplete'
  | 'corrupt'
  | 'incompatible';

export type DiscoveredRun = {
  directory: string;
  metadata: ExistingRunMetadata;
  status: ExistingRunStatus;
  missingLinkedPaths: number;
  loaded: LoadedWorkflowResult;
};

export type WorkflowResultLoader = (
  runDirectory: string,
  manifest: WorkflowManifest,
) => Promise<LoadedWorkflowResult>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function metadataFromConfiguration(
  value: unknown,
  directory: string,
  manifest: WorkflowManifest,
): ExistingRunMetadata {
  const configuration = isRecord(value) ? value : {};
  const run = isRecord(configuration.run) ? configuration.run : {};
  // Read leniently like the other fields: a corrupt run still lists, without what it lacks.
  const genopilot = validateGenoPilot(configuration.genopilot, []);
  return {
    id: stringField(run.id) ?? basename(directory),
    ...(stringField(run.name) ? {name: stringField(run.name)} : {}),
    ...(stringField(run.description) ? {description: stringField(run.description)} : {}),
    workflowId: stringField(configuration.workflow_id) ?? manifest.id,
    workflowVersion: positiveInteger(configuration.workflow_version) ?? manifest.workflow_version,
    ...(stringField(run.created_at) ? {createdAt: stringField(run.created_at)} : {}),
    ...(genopilot ? {genopilot} : {}),
  };
}

function runStatus(loaded: LoadedWorkflowResult): ExistingRunStatus {
  if (loaded.kind === 'compatible') {
    return loaded.shell.runStatus;
  }
  switch (loaded.error.kind) {
    case 'missing-summary':
      return 'incomplete';
    case 'invalid-summary':
    case 'invalid-configuration':
    case 'missing-configuration':
      return 'corrupt';
    case 'identity-mismatch':
    case 'unsupported-workflow':
      return 'incompatible';
  }
}

function missingLinkedPaths(loaded: LoadedWorkflowResult): number {
  if (loaded.kind !== 'compatible') {
    return 0;
  }
  return new Set(loaded.shell.linkedPaths.filter(path => !path.available).map(path => path.absolutePath)).size;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Permanently deletes one direct child of a workflow's run directory. */
export async function deleteWorkflowRun(
  collectionRoot: string,
  workflowId: string,
  runDirectory: string,
): Promise<void> {
  const workflowDirectory = resolve(collectionRoot, workflowId);
  const targetDirectory = resolve(runDirectory);
  if (dirname(targetDirectory) !== workflowDirectory) {
    throw new Error('Refusing to delete a path outside the selected workflow run directory.');
  }

  const [canonicalCollection, canonicalWorkflow, canonicalTarget] = await Promise.all([
    realpath(collectionRoot),
    realpath(workflowDirectory),
    realpath(targetDirectory),
  ]);
  if (
    dirname(canonicalWorkflow) !== canonicalCollection ||
    dirname(canonicalTarget) !== canonicalWorkflow
  ) {
    throw new Error('Refusing to delete a path outside the selected workflow run directory.');
  }

  await rm(targetDirectory, {recursive: true});
}

/** Discovers persisted runs in one workflow collection without starting or resuming them. */
export async function discoverWorkflowRuns(
  collectionRoot: string,
  manifest: WorkflowManifest,
  loadResult: WorkflowResultLoader = loadWorkflowResult,
): Promise<DiscoveredRun[]> {
  const workflowDirectory = resolve(collectionRoot, manifest.id);
  let entries;
  try {
    entries = await readdir(workflowDirectory, {withFileTypes: true});
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const runs = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(async entry => {
      const directory = resolve(workflowDirectory, entry.name);
      let parsedConfiguration: unknown;
      try {
        parsedConfiguration = parse(await readFile(resolve(directory, 'config.yaml'), 'utf8'));
      } catch {
        parsedConfiguration = undefined;
      }
      const loaded = await loadResult(directory, manifest);
      return {
        directory,
        metadata: metadataFromConfiguration(parsedConfiguration, directory, manifest),
        status: runStatus(loaded),
        missingLinkedPaths: missingLinkedPaths(loaded),
        loaded,
      } satisfies DiscoveredRun;
    }));

  runs.sort((left, right) => {
    const byCreation = (right.metadata.createdAt ?? '').localeCompare(left.metadata.createdAt ?? '');
    return byCreation || right.metadata.id.localeCompare(left.metadata.id);
  });
  return runs;
}
