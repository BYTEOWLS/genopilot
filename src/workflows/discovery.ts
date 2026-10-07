import type {Dirent} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {packagedUrl} from '../package-root.js';
import {parseWorkflowManifest, type WorkflowManifest} from './manifest.js';
import {
  parseParameterDefinitions,
  type WorkflowParameterDefinition,
} from './parameter-definitions.js';

export const packagedWorkflowsDirectory = packagedUrl('workflows/');

export type DiscoveredWorkflow = {
  manifest: WorkflowManifest;
  directoryUrl: URL;
  parameterDefinitions: WorkflowParameterDefinition[];
};

export class WorkflowDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkflowDiscoveryError';
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Discovers packaged workflow manifests without depending on the caller's working directory. */
export async function discoverPackagedWorkflows(
  workflowsDirectory: URL = packagedWorkflowsDirectory,
): Promise<DiscoveredWorkflow[]> {
  const directoryBaseUrl = workflowsDirectory.href.endsWith('/')
    ? workflowsDirectory
    : new URL(`${workflowsDirectory.href}/`);
  let entries: Dirent<string>[];
  try {
    entries = await readdir(directoryBaseUrl, {withFileTypes: true});
  } catch (error) {
    throw new WorkflowDiscoveryError(
      `Unable to read packaged workflows from ${directoryBaseUrl.pathname}: ${errorDetail(error)}`,
      {cause: error},
    );
  }

  const workflows: DiscoveredWorkflow[] = [];
  const workflowsById = new Map<string, URL>();
  const directories = entries
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const directory of directories) {
    const directoryUrl = new URL(`${encodeURIComponent(directory.name)}/`, directoryBaseUrl);
    const manifestUrl = new URL('manifest.yaml', directoryUrl);
    let source: string;
    try {
      source = await readFile(manifestUrl, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        continue;
      }
      throw new WorkflowDiscoveryError(
        `Unable to read ${manifestUrl.pathname}: ${errorDetail(error)}`,
        {cause: error},
      );
    }

    let manifest: WorkflowManifest;
    try {
      manifest = parseWorkflowManifest(source);
    } catch (error) {
      throw new WorkflowDiscoveryError(
        `Unable to load ${manifestUrl.pathname}: ${errorDetail(error)}`,
        {cause: error},
      );
    }

    const parameterDefinitionsUrl = new URL(manifest['parameter-definitions'], directoryUrl);
    let parameterDefinitions: WorkflowParameterDefinition[];
    try {
      parameterDefinitions = parseParameterDefinitions(
        await readFile(parameterDefinitionsUrl, 'utf8'),
      );
    } catch (error) {
      throw new WorkflowDiscoveryError(
        `Unable to load ${parameterDefinitionsUrl.pathname}: ${errorDetail(error)}`,
        {cause: error},
      );
    }

    const existingManifestUrl = workflowsById.get(manifest.id);
    if (existingManifestUrl) {
      throw new WorkflowDiscoveryError(
        `Duplicate workflow ID '${manifest.id}' in ${existingManifestUrl.pathname} and ${manifestUrl.pathname}.`,
      );
    }
    workflowsById.set(manifest.id, manifestUrl);
    workflows.push({manifest, directoryUrl, parameterDefinitions});
  }

  return workflows;
}
