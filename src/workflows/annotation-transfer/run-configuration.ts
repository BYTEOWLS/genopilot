import {availableParallelism} from 'node:os';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizeAccession} from '../../accessions/accession.js';
import {conflictingCopiesMessage, recordedCacheState} from '../../accessions/catalog.js';
import {readCatalogedAccessions, type AccessionCatalogReader} from '../../accessions/store.js';
import {
  buildRunId,
  checkReadableFile,
  checkRunDestination,
  createRunWorkspace,
  discoverSavedRuns,
  effectiveCpuCount,
  hasNcbiCacheEntry,
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
  type NcbiCacheMode,
  validateAnnotationTransferConfiguration,
} from './configuration.js';

export {effectiveCpuCount, formatRunTimestampPrefix, sanitizeRunIdSuffix} from '../run-preparation.js';
export type {PathInspection} from '../run-preparation.js';

export type InputSourceMode = 'local' | 'ncbi';

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
  availableCpus: number = availableParallelism(),
  now: Date = new Date(),
): PreparedAnnotationTransferRun {
  const description = draft.runDescription.trim();
  const manualLimit = Number(draft.manualCpuLimit);
  const runName = draft.runName.trim();
  const runId = buildAnnotationTransferRunId(runName, now);
  const configuration = validateAnnotationTransferConfiguration({
    schema_version: ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION,
    workflow_id: ANNOTATION_TRANSFER_WORKFLOW_ID,
    workflow_version: ANNOTATION_TRANSFER_WORKFLOW_VERSION,
    inputs: {
      reference:
        draft.referenceSource === 'ncbi'
          ? {
              source: 'ncbi',
              accession: normalizeAccession(draft.referenceAccession),
              ncbi_cache_mode: 'reuse',
            }
          : {
              source: 'local',
              fasta: resolveDraftPath(currentDirectory, draft.referenceFasta),
              gff3: resolveDraftPath(currentDirectory, draft.referenceGff3),
            },
      target:
        draft.targetSource === 'ncbi'
          ? {
              source: 'ncbi',
              accession: normalizeAccession(draft.targetAccession),
              ncbi_cache_mode: 'reuse',
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

export type NcbiCacheInput = 'reference' | 'target';

export type NcbiCacheEntry = {
  input: NcbiCacheInput;
  accession: string;
};

/** Returns configured NCBI inputs whose accession cache directory already exists. */
export async function findNcbiCacheEntries(
  prepared: PreparedAnnotationTransferRun,
  inspectPath: PathInspection = stat,
): Promise<NcbiCacheEntry[]> {
  const entries: NcbiCacheEntry[] = [];
  for (const input of ['reference', 'target'] as const) {
    const configured = prepared.configuration.inputs[input];
    if (configured.source !== 'ncbi') {
      continue;
    }
    let cached: boolean;
    try {
      cached = await hasNcbiCacheEntry(prepared.configuration.run.output_root, configured.accession, inspectPath);
    } catch (error) {
      throw new AnnotationTransferConfigurationError([
        {path: `$.inputs.${input}.ncbi_cache_mode`, message: error instanceof Error ? error.message : String(error)},
      ]);
    }
    if (cached) {
      entries.push({input, accession: configured.accession});
    }
  }
  return entries;
}

/** Applies explicit cache decisions without changing the rest of the prepared run. */
export function applyNcbiCacheModes(
  prepared: PreparedAnnotationTransferRun,
  modes: Partial<Record<NcbiCacheInput, NcbiCacheMode>>,
): PreparedAnnotationTransferRun {
  const configuration = structuredClone(prepared.configuration);
  for (const input of ['reference', 'target'] as const) {
    const configured = configuration.inputs[input];
    if (configured.source === 'ncbi') {
      configured.ncbi_cache_mode = modes[input] ?? configured.ncbi_cache_mode ?? 'reuse';
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
  const ncbiInputs = [['$.inputs.reference.accession', reference], ['$.inputs.target.accession', target]] as const;
  if (ncbiInputs.some(([, input]) => input.source === 'ncbi')) {
    // The catalog is optional bookkeeping: an unreadable one does not block a run, and its accession
    // field already says it is unavailable.
    const cataloged = await readAccessions().catch(() => []);
    for (const [path, input] of ncbiInputs) {
      const entry = input.source === 'ncbi'
        ? cataloged.find(candidate => candidate.accession === input.accession)
        : undefined;
      if (entry && recordedCacheState(entry) === 'conflict') {
        issues.push({path, message: conflictingCopiesMessage});
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

export async function savePreparedRun(prepared: PreparedAnnotationTransferRun): Promise<string> {
  await validatePreparedRunPaths(prepared);
  const written = await createRunWorkspace(
    prepared.outputDirectory,
    [{name: 'config.yaml', content: stringifyRunFile(prepared.configuration)}],
    () => new AnnotationTransferConfigurationError([
      {path: '$.run.id', message: 'already exists in the selected output root'},
    ]),
  );
  return written['config.yaml'] as string;
}
