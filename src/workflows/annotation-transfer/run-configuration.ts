import {availableParallelism} from 'node:os';
import {access, mkdir, readdir, readFile, rmdir, stat, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {stringify} from 'yaml';
import {normalizeAccession} from '../../accessions/accession.js';
import {conflictingCopiesMessage, recordedCacheState} from '../../accessions/catalog.js';
import {readCatalogedAccessions, type AccessionCatalogReader} from '../../accessions/store.js';
import {formatCompactUtcTimestamp} from '../timestamps.js';
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

export type InputSourceMode = 'local' | 'ncbi';

export type AnnotationTransferConfigurationDraft = {
  referenceSource: InputSourceMode;
  referenceFasta: string;
  referenceGff3: string;
  referenceAccession: string;
  targetSource: InputSourceMode;
  targetFasta: string;
  targetAccession: string;
  idPrefix: string;
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

export type PathInspection = (path: string) => Promise<{isFile(): boolean; isDirectory(): boolean}>;

function errorCode(error: unknown): string | undefined {
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
export function buildAnnotationTransferRunId(label: string, now: Date = new Date()): string {
  const suffix = sanitizeRunIdSuffix(label.trim());
  return `${formatRunTimestampPrefix(now)}${suffix || ANNOTATION_TRANSFER_WORKFLOW_ID}`;
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
    idPrefix: 'AN_CS',
    cpuMode: 'automatic',
    manualCpuLimit: '',
    outputRoot: resolve(currentDirectory, 'runs'),
    runName: '',
    runDescription: '',
  };
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

function resolveDraftPath(currentDirectory: string, value: string): string {
  return value.length === 0 ? '' : resolve(currentDirectory, value);
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
    annotation: {id_prefix: draft.idPrefix},
    lifton: {profile: 'same-species'},
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
    const cacheDirectory = resolve(
      prepared.configuration.run.output_root,
      'ncbi-accessions-cache',
      configured.accession,
    );
    let details;
    try {
      details = await inspectPath(cacheDirectory);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        continue;
      }
      throw new AnnotationTransferConfigurationError([
        {
          path: `$.inputs.${input}.ncbi_cache_mode`,
          message: `cache entry cannot be accessed: ${cacheDirectory}`,
        },
      ]);
    }
    if (!details.isDirectory()) {
      throw new AnnotationTransferConfigurationError([
        {
          path: `$.inputs.${input}.ncbi_cache_mode`,
          message: `cache entry must be a directory: ${cacheDirectory}`,
        },
      ]);
    }
    if (inspectPath === stat) {
      try {
        await access(cacheDirectory, constants.R_OK | constants.W_OK | constants.X_OK);
      } catch {
        throw new AnnotationTransferConfigurationError([
          {
            path: `$.inputs.${input}.ncbi_cache_mode`,
            message: `cache entry must be readable and writable: ${cacheDirectory}`,
          },
        ]);
      }
    }
    entries.push({input, accession: configured.accession});
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

/**
 * Reads every saved annotation-transfer run under `outputRoot`, newest first, so the new-run
 * form can offer them as prefill history. A run directory with a missing or invalid config.yaml
 * is skipped rather than failing discovery for every other run.
 */
export async function discoverAnnotationTransferRuns(
  outputRoot: string,
): Promise<AnnotationTransferRunRecord[]> {
  const workflowDirectory = resolve(outputRoot, ANNOTATION_TRANSFER_WORKFLOW_ID);
  let entries;
  try {
    entries = await readdir(workflowDirectory, {withFileTypes: true});
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const records: AnnotationTransferRunRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = resolve(workflowDirectory, entry.name);
    try {
      const source = await readFile(resolve(directory, 'config.yaml'), 'utf8');
      records.push({directory, configuration: parseAnnotationTransferConfiguration(source)});
    } catch {
      // Skip a run whose configuration is missing or no longer valid.
    }
  }
  records.sort((left, right) =>
    right.configuration.run.created_at.localeCompare(left.configuration.run.created_at),
  );
  return records;
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
    try {
      const details = await inspectPath(value);
      if (!details.isFile()) {
        issues.push({path, message: 'must identify a readable file'});
      } else if (inspectPath === stat) {
        await access(value, constants.R_OK);
      }
    } catch {
      issues.push({path, message: 'must identify a readable file'});
    }
  }
  try {
    const details = await inspectPath(prepared.configuration.run.output_root);
    if (!details.isDirectory()) {
      issues.push({path: '$.run.output_root', message: 'must identify a writable directory'});
    } else if (inspectPath === stat) {
      await access(prepared.configuration.run.output_root, constants.W_OK);
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      issues.push({path: '$.run.output_root', message: 'must identify a writable directory'});
    }
  }
  try {
    await inspectPath(prepared.outputDirectory);
    issues.push({path: '$.run.id', message: 'already exists in the selected output root'});
  } catch {
    // A missing run directory is required for a new run.
  }
  if (issues.length > 0) {
    throw new AnnotationTransferConfigurationError(issues);
  }
}

export async function savePreparedRun(prepared: PreparedAnnotationTransferRun): Promise<string> {
  await validatePreparedRunPaths(prepared);
  await mkdir(dirname(prepared.outputDirectory), {recursive: true, mode: 0o700});
  try {
    await mkdir(prepared.outputDirectory, {mode: 0o700});
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw new AnnotationTransferConfigurationError([
        {path: '$.run.id', message: 'already exists in the selected output root'},
      ]);
    }
    throw error;
  }
  const configurationPath = resolve(prepared.outputDirectory, 'config.yaml');
  try {
    // Snakemake reads config.yaml with a YAML 1.1 loader, which turns unquoted
    // timestamps and words like `no` into non-string values; quote every string.
    const source = stringify(prepared.configuration, {defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN'});
    await writeFile(configurationPath, source, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    await rmdir(prepared.outputDirectory).catch(() => undefined);
    throw error;
  }
  return configurationPath;
}
