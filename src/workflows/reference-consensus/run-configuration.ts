import {availableParallelism} from 'node:os';
import {stat} from 'node:fs/promises';
import {basename, resolve} from 'node:path';
import {normalizeAccession} from '../../accessions/accession.js';
import {
  conflictingCopiesMessage,
  recordedCacheState,
  type AccessionEntry,
} from '../../accessions/catalog.js';
import {readCatalogedAccessions, type AccessionCatalogReader} from '../../accessions/store.js';
import type {Isolate, IsolateCatalog} from '../../isolates/catalog.js';
import {checkReadPairs, type ReadPairsChecker} from '../../isolates/reads.js';
import type {ConfigurationValidationIssue, CpuMode, NcbiCacheMode} from '../configuration-validation.js';
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
  type SavedRunRecord,
} from '../run-preparation.js';
import {
  ISOLATE_SNAPSHOT_FILENAME,
  REFERENCE_CONSENSUS_CONFIGURATION_SCHEMA_VERSION,
  REFERENCE_CONSENSUS_WORKFLOW_ID,
  REFERENCE_CONSENSUS_WORKFLOW_VERSION,
  ReferenceConsensusConfigurationError,
  parseReferenceConsensusConfiguration,
  validateReferenceConsensusConfiguration,
  type ReferenceConsensusConfiguration,
  type VotingMethod,
} from './configuration.js';
import {ISOLATE_SNAPSHOT_SCHEMA_VERSION, validateIsolateSnapshot, type IsolateSnapshot} from './snapshot.js';

export type ReferenceConsensusDraft = {
  backboneSource: 'local' | 'ncbi';
  backboneFasta: string;
  backboneAccession: string;
  isolateIds: readonly string[];
  votingMethod: VotingMethod;
  includeBackboneVote: boolean;
  minDepth: string;
  minMappingQuality: string;
  minBaseQuality: string;
  minAlleleFraction: string;
  cpuMode: CpuMode;
  manualCpuLimit: string;
  outputRoot: string;
  runName: string;
  runDescription: string;
};

export type PreparedReferenceConsensusRun = {
  configuration: ReferenceConsensusConfiguration;
  snapshot: IsolateSnapshot;
  outputDirectory: string;
};

/** A threshold typed into the form; an empty field is not silently read as zero. */
function parseThreshold(value: string): number {
  return value.trim().length === 0 ? Number.NaN : Number(value.trim());
}

/**
 * Builds the run's configuration and its isolate snapshot. The snapshot copies each selected
 * catalog record, with every read pair and its `trimmed` flag, so the run never reads the
 * catalog again. A selected ID that is no longer cataloged is refused rather than dropped.
 */
export function buildReferenceConsensusRun(
  draft: ReferenceConsensusDraft,
  catalog: IsolateCatalog,
  currentDirectory: string,
  availableCpus: number = availableParallelism(),
  now: Date = new Date(),
): PreparedReferenceConsensusRun {
  const staleIssues: ConfigurationValidationIssue[] = [];
  const isolates: Isolate[] = [];
  draft.isolateIds.forEach((id, index) => {
    const isolate = catalog.isolates.find(candidate => candidate.id === id);
    if (isolate) {
      isolates.push(structuredClone({
        ...isolate,
        read_pairs: isolate.read_pairs.map(pair => ({...pair, r1: resolve(pair.r1), r2: resolve(pair.r2)})),
      }));
    } else {
      staleIssues.push({
        path: `$.inputs.selected_isolates[${index}]`,
        message: `'${id}' is no longer in the isolate catalog`,
      });
    }
  });
  if (staleIssues.length > 0) {
    throw new ReferenceConsensusConfigurationError(staleIssues);
  }

  const description = draft.runDescription.trim();
  const runName = draft.runName.trim();
  const configuration = validateReferenceConsensusConfiguration({
    schema_version: REFERENCE_CONSENSUS_CONFIGURATION_SCHEMA_VERSION,
    workflow_id: REFERENCE_CONSENSUS_WORKFLOW_ID,
    workflow_version: REFERENCE_CONSENSUS_WORKFLOW_VERSION,
    inputs: {
      backbone: draft.backboneSource === 'ncbi'
        ? {source: 'ncbi', accession: normalizeAccession(draft.backboneAccession), ncbi_cache_mode: 'reuse'}
        : {source: 'local', fasta: resolveDraftPath(currentDirectory, draft.backboneFasta)},
      isolates_file: ISOLATE_SNAPSHOT_FILENAME,
      selected_isolates: [...draft.isolateIds],
    },
    calling: {
      ploidy: 1,
      min_depth: parseThreshold(draft.minDepth),
      min_mapping_quality: parseThreshold(draft.minMappingQuality),
      min_base_quality: parseThreshold(draft.minBaseQuality),
      min_allele_fraction: parseThreshold(draft.minAlleleFraction),
    },
    consensus: {
      include_backbone_vote: draft.includeBackboneVote,
      voting_method: draft.votingMethod,
    },
    resources: {
      cpu_mode: draft.cpuMode,
      ...(draft.cpuMode === 'manual' ? {manual_limit: Number(draft.manualCpuLimit)} : {}),
      effective_cpus: effectiveCpuCount(draft.cpuMode, draft.manualCpuLimit, availableCpus),
    },
    run: {
      output_root: resolveDraftPath(currentDirectory, draft.outputRoot),
      id: buildRunId(runName, REFERENCE_CONSENSUS_WORKFLOW_ID, now),
      ...(runName ? {name: runName} : {}),
      created_at: now.toISOString(),
      ...(description ? {description} : {}),
    },
  });
  const snapshot = validateIsolateSnapshot(
    {schema_version: ISOLATE_SNAPSHOT_SCHEMA_VERSION, captured_at: now.toISOString(), isolates},
    configuration.inputs.selected_isolates,
  );
  return {
    configuration,
    snapshot,
    outputDirectory: resolve(configuration.run.output_root, REFERENCE_CONSENSUS_WORKFLOW_ID, configuration.run.id),
  };
}

/**
 * Snakemake reads braces in a declared input path as wildcards, even when escaped, so a file whose
 * path contains one cannot be an input of the workflow. It has to be renamed or linked elsewhere.
 */
function hasBraces(path: string): boolean {
  return path.includes('{') || path.includes('}');
}

const bracesMessage = "path contains '{' or '}', which Snakemake cannot use as an input; rename the file or its folder";

/** What checking the prepared run found out that the review shows. */
export type RunInspection = {
  /** The accession-catalog entry of an NCBI backbone, when it is cataloged. */
  backboneEntry?: AccessionEntry;
  /** Read paths of the selection that name one file more than once. */
  sameFiles: readonly {first: string; second: string}[];
};

export type RunInspectionDependencies = {
  inspectPath?: PathInspection;
  readAccessions?: AccessionCatalogReader;
  checkReads?: ReadPairsChecker;
};

/**
 * Refuses a run whose inputs cannot be used: an unreadable local backbone, a cataloged accession
 * with conflicting copies, a selected read file that is missing, unreadable or not FASTQ, an
 * input path Snakemake cannot declare, an unusable output root, or an existing run directory.
 */
export async function inspectPreparedRun(
  prepared: PreparedReferenceConsensusRun,
  {
    inspectPath = stat,
    readAccessions = readCatalogedAccessions,
    checkReads = checkReadPairs,
  }: RunInspectionDependencies = {},
): Promise<RunInspection> {
  const issues: ConfigurationValidationIssue[] = [];
  const {backbone} = prepared.configuration.inputs;
  let backboneEntry: AccessionEntry | undefined;
  if (backbone.source === 'ncbi') {
    // The catalog is optional bookkeeping: an unreadable one does not block a run.
    const cataloged = await readAccessions().catch(() => []);
    backboneEntry = cataloged.find(entry => entry.accession === backbone.accession);
    if (backboneEntry && recordedCacheState(backboneEntry) === 'conflict') {
      issues.push({path: '$.inputs.backbone.accession', message: conflictingCopiesMessage});
    }
  } else {
    await checkReadableFile(backbone.fasta, '$.inputs.backbone.fasta', issues, inspectPath);
    if (hasBraces(backbone.fasta)) {
      issues.push({path: '$.inputs.backbone.fasta', message: bracesMessage});
    }
  }

  const pairs = prepared.snapshot.isolates.flatMap(isolate =>
    isolate.read_pairs.map((pair, index) => ({isolate, index, pair})));
  const readCheck = await checkReads(pairs.map(({pair}) => pair));
  readCheck.pairs.forEach((result, position) => {
    const entry = pairs[position];
    if (!entry) {
      return;
    }
    for (const mate of ['r1', 'r2'] as const) {
      const check = result[mate];
      if (hasBraces(entry.pair[mate])) {
        issues.push({
          path: `isolate '${entry.isolate.id}' pair ${String(entry.index + 1)} ${mate.toUpperCase()}`,
          message: `${bracesMessage}: ${entry.pair[mate]}`,
        });
      } else if (check.state !== 'ok') {
        issues.push({
          path: `isolate '${entry.isolate.id}' pair ${String(entry.index + 1)} ${mate.toUpperCase()}`,
          message: `${check.reason}: ${entry.pair[mate]}`,
        });
      }
    }
  });

  await checkRunDestination(prepared.configuration.run.output_root, prepared.outputDirectory, issues, inspectPath);
  if (issues.length > 0) {
    throw new ReferenceConsensusConfigurationError(issues);
  }
  return {...(backboneEntry ? {backboneEntry} : {}), sameFiles: readCheck.sameFiles};
}

/** Lowercase letters and digits only, so `FGSC A4` and `fgsc-a4` compare equal. */
function comparableName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Only an exact match counts: mutants are commonly named after their parent strain, so a name
 * merely containing the backbone's strain would flag every derived line of a cohort.
 */
function sameName(left: string, right: string): boolean {
  const comparable = comparableName(left);
  return comparable.length > 0 && comparable === comparableName(right);
}

/** Names the backbone's biological sample is known by: its NCBI strain, or a local file's name. */
function backboneSampleNames(prepared: PreparedReferenceConsensusRun, inspection: RunInspection): string[] {
  const {backbone} = prepared.configuration.inputs;
  if (backbone.source === 'local') {
    return [basename(backbone.fasta).replace(/\.(fa|fasta|fna)(\.gz)?$/i, '')];
  }
  const strain = inspection.backboneEntry?.ncbi?.strain;
  return strain ? [strain] : [];
}

/**
 * Problems that do not stop a run but that the researcher should see before starting it: one
 * file behind two read paths, an isolate that may be the backbone's own sample, and a selection
 * mixing trimmed and untrimmed reads, which the cohort would then not process consistently.
 */
export function reviewWarnings(
  prepared: PreparedReferenceConsensusRun,
  inspection: RunInspection,
): string[] {
  const warnings: string[] = [];
  for (const {first, second} of inspection.sameFiles) {
    warnings.push(`${first} and ${second} are the same file, so its reads would count twice.`);
  }
  const sampleNames = backboneSampleNames(prepared, inspection);
  for (const isolate of prepared.snapshot.isolates) {
    const match = sampleNames.find(name => sameName(name, isolate.name) || sameName(name, isolate.id));
    if (match) {
      warnings.push(
        `${isolate.name} (${isolate.id}) may be the same biological sample as the backbone (${match}); ` +
          'its reads would then vote for the backbone twice.',
      );
    }
  }
  const pairs = prepared.snapshot.isolates.flatMap(isolate => isolate.read_pairs);
  const trimmed = pairs.filter(pair => pair.trimmed).length;
  if (trimmed > 0 && trimmed < pairs.length) {
    const trimmedIsolates = prepared.snapshot.isolates
      .filter(isolate => isolate.read_pairs.some(pair => pair.trimmed))
      .map(isolate => isolate.name);
    warnings.push(
      `The selection mixes trimmed and untrimmed reads (trimmed: ${trimmedIsolates.join(', ')}), so the ` +
        'cohort would not be processed consistently.',
    );
  }
  return warnings;
}

/** Whether the backbone accession already has a cache entry under the output root. */
export async function hasBackboneCacheEntry(
  prepared: PreparedReferenceConsensusRun,
  inspectPath: PathInspection = stat,
): Promise<boolean> {
  const {backbone} = prepared.configuration.inputs;
  if (backbone.source !== 'ncbi') {
    return false;
  }
  try {
    return await hasNcbiCacheEntry(prepared.configuration.run.output_root, backbone.accession, inspectPath);
  } catch (error) {
    throw new ReferenceConsensusConfigurationError([
      {path: '$.inputs.backbone.ncbi_cache_mode', message: error instanceof Error ? error.message : String(error)},
    ]);
  }
}

/** Applies the researcher's explicit cache decision without changing the rest of the run. */
export function applyBackboneCacheMode(
  prepared: PreparedReferenceConsensusRun,
  mode: NcbiCacheMode,
): PreparedReferenceConsensusRun {
  const configuration = structuredClone(prepared.configuration);
  if (configuration.inputs.backbone.source === 'ncbi') {
    configuration.inputs.backbone.ncbi_cache_mode = mode;
  }
  return {...prepared, configuration: validateReferenceConsensusConfiguration(configuration)};
}

/**
 * Checks the run once more and creates its workspace: the isolate snapshot first, then the
 * configuration that refers to it. A failure leaves no partial run directory behind.
 */
export async function savePreparedRun(
  prepared: PreparedReferenceConsensusRun,
  dependencies: RunInspectionDependencies = {},
): Promise<string> {
  await inspectPreparedRun(prepared, dependencies);
  const written = await createRunWorkspace(
    prepared.outputDirectory,
    [
      {name: ISOLATE_SNAPSHOT_FILENAME, content: stringifyRunFile(prepared.snapshot)},
      {name: 'config.yaml', content: stringifyRunFile(prepared.configuration)},
    ],
    () => new ReferenceConsensusConfigurationError([
      {path: '$.run.id', message: 'already exists in the selected output root'},
    ]),
  );
  return written['config.yaml'] as string;
}

/** Reads every saved reference-consensus run under `outputRoot`, newest first. */
export async function discoverReferenceConsensusRuns(
  outputRoot: string,
): Promise<SavedRunRecord<ReferenceConsensusConfiguration>[]> {
  return discoverSavedRuns(outputRoot, REFERENCE_CONSENSUS_WORKFLOW_ID, parseReferenceConsensusConfiguration);
}
