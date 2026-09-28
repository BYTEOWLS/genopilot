import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import type {WorkflowManifest} from './manifest.js';
import {
  ANNOTATION_TRANSFER_WORKFLOW_ID,
  ANNOTATION_TRANSFER_WORKFLOW_VERSION,
  AnnotationTransferConfigurationError,
  parseAnnotationTransferConfiguration,
  type AnnotationTransferConfiguration,
} from './annotation-transfer/configuration.js';
import {
  AnnotationTransferResultError,
  readAnnotationTransferResult,
  type AnnotationTransferResult,
  type ResultPath,
} from './annotation-transfer/results.js';
import {
  ISOLATE_SNAPSHOT_FILENAME,
  parseReferenceConsensusConfiguration,
  REFERENCE_CONSENSUS_WORKFLOW_ID,
  REFERENCE_CONSENSUS_WORKFLOW_VERSION,
  ReferenceConsensusConfigurationError,
  type ReferenceConsensusConfiguration,
} from './reference-consensus/configuration.js';
import {readReferenceConsensusResult, type ReferenceConsensusResult} from './reference-consensus/results.js';
import {parseIsolateSnapshot, type IsolateSnapshot} from './reference-consensus/snapshot.js';

export type WorkflowResultCompatibilityError = {
  kind:
    | 'missing-configuration'
    | 'invalid-configuration'
    | 'identity-mismatch'
    | 'unsupported-workflow'
    | 'missing-summary'
    | 'invalid-summary';
  message: string;
  path?: string;
  issues?: readonly {path: string; message: string}[];
};

/** What the workflow-independent result shell and run discovery need from every workflow's result. */
export type ResultShell = {
  /** The run's state for the run list: a scientific status, or `incomplete` while no result exists. */
  runStatus: 'completed' | 'completed-with-warnings' | 'validation-failed' | 'incomplete';
  status: {variant: 'success' | 'warning' | 'error'; explanation: string};
  generatedAt?: string;
  effectiveCpus: number;
  /** Paths that should exist now; unavailable ones are reported as missing. */
  linkedPaths: readonly ResultPath[];
};

export type CompatibleAnnotationTransferResult = {
  kind: 'compatible';
  workflow: {id: typeof ANNOTATION_TRANSFER_WORKFLOW_ID; version: typeof ANNOTATION_TRANSFER_WORKFLOW_VERSION};
  configuration: AnnotationTransferConfiguration;
  result: AnnotationTransferResult;
  shell: ResultShell;
};

export type CompatibleReferenceConsensusResult = {
  kind: 'compatible';
  workflow: {id: typeof REFERENCE_CONSENSUS_WORKFLOW_ID; version: typeof REFERENCE_CONSENSUS_WORKFLOW_VERSION};
  configuration: ReferenceConsensusConfiguration;
  snapshot: IsolateSnapshot;
  result: ReferenceConsensusResult;
  shell: ResultShell;
};

export type LoadedWorkflowResult =
  | CompatibleAnnotationTransferResult
  | CompatibleReferenceConsensusResult
  | {kind: 'incompatible'; error: WorkflowResultCompatibilityError};

export function isAnnotationTransferResult(loaded: LoadedWorkflowResult): loaded is CompatibleAnnotationTransferResult {
  return loaded.kind === 'compatible' && loaded.workflow.id === ANNOTATION_TRANSFER_WORKFLOW_ID;
}

export function isReferenceConsensusResult(loaded: LoadedWorkflowResult): loaded is CompatibleReferenceConsensusResult {
  return loaded.kind === 'compatible' && loaded.workflow.id === REFERENCE_CONSENSUS_WORKFLOW_ID;
}

/** The shell's view of an annotation-transfer result. */
export function annotationTransferShell(result: AnnotationTransferResult, effectiveCpus: number): ResultShell {
  let variant: ResultShell['status']['variant'];
  if (result.status === 'completed') {
    variant = 'success';
  } else if (result.status === 'completed-with-warnings') {
    variant = 'warning';
  } else {
    variant = 'error';
  }
  return {
    runStatus: result.status,
    status: {variant, explanation: result.statusExplanation},
    generatedAt: result.generatedAt,
    effectiveCpus,
    linkedPaths: [result.metricsPath, ...Object.values(result.reports), ...Object.values(result.evidence)],
  };
}

function referenceConsensusShell(result: ReferenceConsensusResult): ResultShell {
  return {
    runStatus: result.activeCohortId ? 'completed' : 'incomplete',
    status: result.status,
    ...(result.generatedAt ? {generatedAt: result.generatedAt} : {}),
    effectiveCpus: result.effectiveCpus,
    linkedPaths: result.linkedPaths,
  };
}

async function loadReferenceConsensusResult(
  directory: string,
  configurationPath: string,
  source: string,
): Promise<LoadedWorkflowResult> {
  let configuration: ReferenceConsensusConfiguration;
  try {
    configuration = parseReferenceConsensusConfiguration(source);
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {
        kind: 'invalid-configuration',
        message: `Saved run configuration is invalid: ${detail(error)}`,
        path: configurationPath,
        ...(error instanceof ReferenceConsensusConfigurationError ? {issues: error.issues} : {}),
      },
    };
  }
  const snapshotPath = resolve(directory, ISOLATE_SNAPSHOT_FILENAME);
  let snapshot: IsolateSnapshot;
  try {
    snapshot = parseIsolateSnapshot(await readFile(snapshotPath, 'utf8'), configuration.inputs.selected_isolates);
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {
        kind: errorCode(error) === 'ENOENT' ? 'missing-configuration' : 'invalid-configuration',
        message: `Saved isolate snapshot cannot be used: ${detail(error)}`,
        path: snapshotPath,
        ...(error instanceof ReferenceConsensusConfigurationError ? {issues: error.issues} : {}),
      },
    };
  }
  const result = await readReferenceConsensusResult(directory, configuration, snapshot);
  return {
    kind: 'compatible',
    workflow: {id: REFERENCE_CONSENSUS_WORKFLOW_ID, version: REFERENCE_CONSENSUS_WORKFLOW_VERSION},
    configuration,
    snapshot,
    result,
    shell: referenceConsensusShell(result),
  };
}

type WorkflowIdentity = {id: string; version: number};

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configurationIdentity(value: unknown): WorkflowIdentity | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const configuration = value as Record<string, unknown>;
  if (typeof configuration.workflow_id !== 'string' ||
      !Number.isSafeInteger(configuration.workflow_version) ||
      (configuration.workflow_version as number) < 1) {
    return undefined;
  }
  return {id: configuration.workflow_id, version: configuration.workflow_version as number};
}

/** Loads a persisted run through the explicit reader for its supported workflow contract. */
export async function loadWorkflowResult(
  runDirectory: string,
  manifest: WorkflowManifest,
): Promise<LoadedWorkflowResult> {
  const directory = resolve(runDirectory);
  const configurationPath = resolve(directory, 'config.yaml');
  let source: string;
  try {
    source = await readFile(configurationPath, 'utf8');
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {
        kind: errorCode(error) === 'ENOENT' ? 'missing-configuration' : 'invalid-configuration',
        message: `Unable to read saved run configuration: ${detail(error)}`,
        path: configurationPath,
      },
    };
  }

  let parsedConfiguration: unknown;
  try {
    parsedConfiguration = parse(source);
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {kind: 'invalid-configuration', message: `Saved run configuration is not valid YAML: ${detail(error)}`, path: configurationPath},
    };
  }
  const identity = configurationIdentity(parsedConfiguration);
  if (!identity) {
    return {
      kind: 'incompatible',
      error: {kind: 'invalid-configuration', message: 'Saved run configuration has no valid workflow ID and version.', path: configurationPath},
    };
  }
  if (identity.id !== manifest.id || identity.version !== manifest.workflow_version) {
    return {
      kind: 'incompatible',
      error: {
        kind: 'identity-mismatch',
        message: `Saved workflow ${identity.id}@${String(identity.version)} does not match packaged workflow ${manifest.id}@${String(manifest.workflow_version)}.`,
      },
    };
  }
  if (identity.id === REFERENCE_CONSENSUS_WORKFLOW_ID && identity.version === REFERENCE_CONSENSUS_WORKFLOW_VERSION) {
    return loadReferenceConsensusResult(directory, configurationPath, source);
  }
  if (identity.id !== ANNOTATION_TRANSFER_WORKFLOW_ID || identity.version !== ANNOTATION_TRANSFER_WORKFLOW_VERSION) {
    return {
      kind: 'incompatible',
      error: {kind: 'unsupported-workflow', message: `This application cannot interpret results for ${identity.id}@${String(identity.version)}.`},
    };
  }

  let configuration: AnnotationTransferConfiguration;
  try {
    configuration = parseAnnotationTransferConfiguration(source);
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {
        kind: 'invalid-configuration',
        message: `Saved run configuration is invalid: ${detail(error)}`,
        path: configurationPath,
        ...(error instanceof AnnotationTransferConfigurationError ? {issues: error.issues} : {}),
      },
    };
  }

  const summaryPath = resolve(directory, 'results/summary.json');
  let summarySource: string;
  try {
    summarySource = await readFile(summaryPath, 'utf8');
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {
        kind: errorCode(error) === 'ENOENT' ? 'missing-summary' : 'invalid-summary',
        message: `Unable to read completion summary: ${detail(error)}`,
        path: summaryPath,
      },
    };
  }
  let summary: unknown;
  try {
    summary = JSON.parse(summarySource) as unknown;
  } catch (error) {
    return {
      kind: 'incompatible',
      error: {kind: 'invalid-summary', message: `Completion summary is not valid JSON: ${detail(error)}`, path: summaryPath},
    };
  }
  try {
    const result = await readAnnotationTransferResult(summary, directory);
    const identityIssues: Array<{path: string; message: string}> = [];
    if (result.run.id !== configuration.run.id) {
      identityIssues.push({path: '$.run.id', message: `must equal saved run ID '${configuration.run.id}'`});
    }
    if (result.run.createdAt !== configuration.run.created_at) {
      identityIssues.push({path: '$.run.created_at', message: 'must equal the saved run creation timestamp'});
    }
    if (result.run.effectiveCpus !== configuration.resources.effective_cpus) {
      identityIssues.push({path: '$.run.effective_cpus', message: 'must equal the saved effective CPU count'});
    }
    if (identityIssues.length > 0) {
      throw new AnnotationTransferResultError(identityIssues);
    }
    return {
      kind: 'compatible',
      workflow: {id: ANNOTATION_TRANSFER_WORKFLOW_ID, version: ANNOTATION_TRANSFER_WORKFLOW_VERSION},
      configuration,
      result,
      shell: annotationTransferShell(result, configuration.resources.effective_cpus),
    };
  } catch (error) {
    if (error instanceof AnnotationTransferResultError) {
      return {
        kind: 'incompatible',
        error: {kind: 'invalid-summary', message: error.message, path: summaryPath, issues: error.issues},
      };
    }
    throw error;
  }
}
