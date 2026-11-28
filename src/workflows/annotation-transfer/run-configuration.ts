import {requireDownloadedGenome, type GenomeCacheMode} from '../genome-input.js';
import {availableParallelism} from 'node:os';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {selectedGenome} from '../../accessions/selection.js';
import {conflictingCopiesMessage, recordedCacheState} from '../../accessions/catalog.js';
import {readCatalogedAccessions, type AccessionCatalogReader} from '../../accessions/store.js';
import {
  buildRunId,
  checkReadableFile,
  checkRunDestination,
  createRunWorkspace,
  discoverSavedRuns,
  effectiveCpuCount,
  hasGenomeCacheEntry,
  resolveDraftPath,
  stringifyRunFile,
  type PathInspection,
} from '../run-preparation.js';
import {
  ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION,
  ANNOTATION_TRANSFER_WORKFLOW_ID,
  ANNOTATION_TRANSFER_WORKFLOW_VERSION,
  AnnotationTransferConfigurationError,
  parseAnnotationTransferConfiguration,
  type AnnotationTransferConfiguration,
  type ConfigurationValidationIssue,
  type CpuMode,
  validateAnnotationTransferConfiguration,
} from './configuration.js';
import {machineDetails, type GenoPilotDetails, type MachineDetails} from '../configuration-validation.js';

export {effectiveCpuCount, formatRunTimestampPrefix, sanitizeRunIdSuffix} from '../run-preparation.js';
export type {PathInspection} from '../run-preparation.js';

export type InputSourceMode = 'local' | 'remote';

export type AnnotationTransferConfigurationDraft = {
  referenceSource: InputSourceMode;
  referenceFasta: string;
  referenceGff3: string;
  referenceAccession: string;
  targetSource: InputSourceMode;
  targetFasta: string;
  targetAccession: string;
  minimumProteinIdentity: string;
  cpuMode: CpuMode;
  manualCpuLimit: string;
  outputRoot: string;
  runName: string;
  runDescription: string;
};

export type PreparedAnnotationTransferRun = {
  configuration: AnnotationTransferConfiguration;
  outputDirectory: string;
};

export function buildAnnotationTransferRunId(label: string, now: Date = new Date()): string {
  return buildRunId(label, ANNOTATION_TRANSFER_WORKFLOW_ID, now);
}

export function createAnnotationTransferDraft(
  currentDirectory: string,
): AnnotationTransferConfigurationDraft {
  return {
    referenceSource: 'local',
    referenceFasta: '',
    referenceGff3: '',
    referenceAccession: '',
    targetSource: 'local',
    targetFasta: '',
    targetAccession: '',
    minimumProteinIdentity: '99',
    cpuMode: 'automatic',
    manualCpuLimit: '',
    outputRoot: resolve(currentDirectory, 'runs'),
    runName: '',
    runDescription: '',
  };
}

export function buildAnnotationTransferConfiguration(
  draft: AnnotationTransferConfigurationDraft,
  currentDirectory: string,
  genopilot: GenoPilotDetails,
  availableCpus: number = availableParallelism(),
  now: Date = new Date(),
  machine: MachineDetails = machineDetails(),
): PreparedAnnotationTransferRun {
  const description = draft.runDescription.trim();
  const manualLimit = Number(draft.manualCpuLimit);
  const runName = draft.runName.trim();
  const runId = buildAnnotationTransferRunId(runName, now);
  const configuration = validateAnnotationTransferConfiguration({
    schema_version: ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION,
    workflow_id: ANNOTATION_TRANSFER_WORKFLOW_ID,
    workflow_version: ANNOTATION_TRANSFER_WORKFLOW_VERSION,
    genopilot,
    inputs: {
      reference:
        draft.referenceSource === 'remote'
          ? {
              source: 'remote',
              reference: selectedGenome(draft.referenceAccession),
              cache_mode: 'reuse',
            }
          : {
              source: 'local',
              fasta: resolveDraftPath(currentDirectory, draft.referenceFasta),
              gff3: resolveDraftPath(currentDirectory, draft.referenceGff3),
            },
      target:
        draft.targetSource === 'remote'
          ? {
              source: 'remote',
              reference: selectedGenome(draft.targetAccession),
              cache_mode: 'reuse',
            }
          : {source: 'local', fasta: resolveDraftPath(currentDirectory, draft.targetFasta)},
    },
    lifton: {profile: 'same-species'},
    // An empty field is not silently read as zero.
    review: {minimum_protein_identity: draft.minimumProteinIdentity.trim() ? Number(draft.minimumProteinIdentity.trim()) : Number.NaN},
    resources: {
      cpu_mode: draft.cpuMode,
      ...(draft.cpuMode === 'manual' ? {manual_limit: manualLimit} : {}),
      effective_cpus: effectiveCpuCount(draft.cpuMode, draft.manualCpuLimit, availableCpus),
      machine,
    },
    run: {
      output_root: resolveDraftPath(currentDirectory, draft.outputRoot),
      id: runId,
      ...(runName ? {name: runName} : {}),
      created_at: now.toISOString(),
      ...(description ? {description} : {}),
    },
  });

  return {
    configuration,
    outputDirectory: resolve(
      configuration.run.output_root,
      ANNOTATION_TRANSFER_WORKFLOW_ID,
      configuration.run.id,
    ),
  };
}

export type GenomeCacheInput = 'reference' | 'target';

export type GenomeCacheEntry = {
  input: GenomeCacheInput;
  id: string;
};

/** Returns remote inputs with a snapshotted copy or an existing provider cache directory. */
export async function findGenomeCacheEntries(
  prepared: PreparedAnnotationTransferRun,
  inspectPath: PathInspection = stat,
): Promise<GenomeCacheEntry[]> {
  const entries: GenomeCacheEntry[] = [];
  for (const input of ['reference', 'target'] as const) {
    const configured = prepared.configuration.inputs[input];
    if (configured.source !== 'remote') {
      continue;
    }
    let cached: boolean;
    try {
      cached = !!configured.copy || await hasGenomeCacheEntry(prepared.configuration.run.output_root, configured.reference, inspectPath);
    } catch (error) {
      throw new AnnotationTransferConfigurationError([
        {path: `$.inputs.${input}.cache_mode`, message: error instanceof Error ? error.message : String(error)},
      ]);
    }
    if (cached) {
      entries.push({input, id: configured.reference.id});
    }
  }
  return entries;
}

/** Applies explicit cache decisions without changing the rest of the prepared run. */
export function applyGenomeCacheModes(
  prepared: PreparedAnnotationTransferRun,
  modes: Partial<Record<GenomeCacheInput, GenomeCacheMode>>,
): PreparedAnnotationTransferRun {
  const configuration = structuredClone(prepared.configuration);
  for (const input of ['reference', 'target'] as const) {
    const configured = configuration.inputs[input];
    if (configured.source === 'remote') {
      configured.cache_mode = modes[input] ?? configured.cache_mode;
      if (configured.cache_mode === 'refresh') {
        delete configured.copy;
      }
    }
  }
  return {...prepared, configuration: validateAnnotationTransferConfiguration(configuration)};
}

export type AnnotationTransferRunRecord = {
  directory: string;
  configuration: AnnotationTransferConfiguration;
};

/** Reads every saved annotation-transfer run under `outputRoot`, newest first. */
export async function discoverAnnotationTransferRuns(
  outputRoot: string,
): Promise<AnnotationTransferRunRecord[]> {
  return discoverSavedRuns(outputRoot, ANNOTATION_TRANSFER_WORKFLOW_ID, parseAnnotationTransferConfiguration);
}

export async function validatePreparedRunPaths(
  prepared: PreparedAnnotationTransferRun,
  inspectPath: PathInspection = stat,
  readAccessions: AccessionCatalogReader = readCatalogedAccessions,
): Promise<void> {
  const issues: ConfigurationValidationIssue[] = [];
  const {reference, target} = prepared.configuration.inputs;
  const remoteInputs = [['$.inputs.reference.reference', reference], ['$.inputs.target.reference', target]] as const;
  if (remoteInputs.some(([, input]) => input.source === 'remote')) {
    const cataloged = await readAccessions().catch(() => []);
    for (const [path, input] of remoteInputs) {
      const entry = input.source === 'remote'
        ? cataloged.find(candidate => candidate.source === input.reference.source && candidate.id === input.reference.id)
        : undefined;
      if (entry && recordedCacheState(entry) === 'conflict') {
        issues.push({path, message: conflictingCopiesMessage});
      } else if (input.source === 'remote') {
        requireDownloadedGenome(input, input === reference ? ['fasta', 'gff3'] : ['fasta'], cataloged, path, issues);
      }
    }
  }
  const localFileChecks: Array<readonly [string, string]> = [];
  if (reference.source === 'local') {
    localFileChecks.push(
      ['$.inputs.reference.fasta', reference.fasta],
      ['$.inputs.reference.gff3', reference.gff3],
    );
  }
  if (target.source === 'local') {
    localFileChecks.push(['$.inputs.target.fasta', target.fasta]);
  }
  for (const [path, value] of localFileChecks) {
    await checkReadableFile(value, path, issues, inspectPath);
  }
  await checkRunDestination(
    prepared.configuration.run.output_root,
    prepared.outputDirectory,
    issues,
    inspectPath,
  );
  if (issues.length > 0) {
    throw new AnnotationTransferConfigurationError(issues);
  }
}

export async function savePreparedRun(
  prepared: PreparedAnnotationTransferRun,
  inspectPath: PathInspection = stat,
  readAccessions: AccessionCatalogReader = readCatalogedAccessions,
): Promise<string> {
  validateAnnotationTransferConfiguration(prepared.configuration);
  await validatePreparedRunPaths(prepared, inspectPath, readAccessions);
  validateAnnotationTransferConfiguration(prepared.configuration);
  const written = await createRunWorkspace(
    prepared.outputDirectory,
    [{name: 'config.yaml', content: stringifyRunFile(prepared.configuration)}],
    () => new AnnotationTransferConfigurationError([
      {path: '$.run.id', message: 'already exists in the selected output root'},
    ]),
  );
  return written['config.yaml'] as string;
}
