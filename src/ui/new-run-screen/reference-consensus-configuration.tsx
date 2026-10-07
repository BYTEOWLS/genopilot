import {basename, resolve} from 'node:path';
import React, {useEffect, useState} from 'react';
import {scanAccessionCaches} from '../../accessions/cache-discovery.js';
import {accessionDisplayName, recordedCacheState} from '../../accessions/catalog.js';
import {refreshAccessionCaches} from '../../accessions/registration.js';
import {loadAccessionCatalog, updateAccessionCatalog} from '../../accessions/store.js';
import type {IsolateCatalog} from '../../isolates/catalog.js';
import {lineage, trimmedStatus} from '../../isolates/presentation.js';
import {loadIsolateCatalog} from '../../isolates/store.js';
import {isNcbiApiKeyConfigured} from '../../tooling/ncbi-api-key.js';
import {resolveToolingPaths} from '../../tooling/paths.js';
import type {GenoPilotDetails} from '../../workflows/configuration-validation.js';
import {
  executeSnakemakeRun as defaultExecuteSnakemakeRun,
  prepareSnakemakeRun as defaultPrepareSnakemakeRun,
  type WorkflowOutput,
} from '../../workflows/execution.js';
import type {WorkflowManifest, WorkflowStage} from '../../workflows/manifest.js';
import type {WorkflowParameterDefinition} from '../../workflows/parameter-definitions.js';
import type {
  ReferenceConsensusConfiguration,
  VotingMethod,
} from '../../workflows/reference-consensus/configuration.js';
import {completedIsolates} from '../../workflows/reference-consensus/isolate-results.js';
import {
  applyBackboneCacheMode,
  buildReferenceConsensusRun,
  discoverReferenceConsensusRuns,
  hasBackboneCacheEntry,
  inspectPreparedRun,
  reviewWarnings,
  savePreparedRun,
  type PreparedReferenceConsensusRun,
  type ReferenceConsensusDraft,
  type RunInspection,
} from '../../workflows/reference-consensus/run-configuration.js';
import {parseIsolateSelection, type IsolateCatalogReader} from '../components/isolates-field.js';
import type {AccessionCacheRegistration, NcbiApiKeyCheck, PreviousRunsLoader} from './annotation-transfer-configuration.js';
import {previousRunLabel} from './annotation-transfer-configuration.js';
import WorkflowConfigurationScreen, {
  type PreparedWorkflowRun,
  type ReviewSection,
  type WorkflowFormValues,
} from './workflow-configuration.js';

export type IsolateCatalogSnapshotLoader = () => Promise<IsolateCatalog>;
export type ReferenceConsensusRunInspector = (prepared: PreparedReferenceConsensusRun) => Promise<RunInspection>;
export type ReferenceConsensusRunSaver = (prepared: PreparedReferenceConsensusRun) => Promise<string>;
export type BackboneCacheCheck = (prepared: PreparedReferenceConsensusRun) => Promise<boolean>;

async function defaultLoadIsolateCatalog(): Promise<IsolateCatalog> {
  return (await loadIsolateCatalog(resolveToolingPaths().isolateCatalogPath)).catalog;
}

async function defaultNcbiApiKeyCheck(): Promise<boolean> {
  return isNcbiApiKeyConfigured(resolveToolingPaths().ncbiApiKeyPath);
}

async function defaultRegisterAccessionCaches(outputRoot: string, currentDirectory: string): Promise<string> {
  const catalogPath = resolveToolingPaths().accessionCatalogPath;
  try {
    await refreshAccessionCaches({
      currentDirectory,
      loadCatalog: () => loadAccessionCatalog(catalogPath),
      updateCatalog: (revision, mutate) => updateAccessionCatalog(catalogPath, revision, mutate),
      scanCaches: scanAccessionCaches,
      addRoot: outputRoot,
      onlyAddedRoot: true,
    });
  } catch (error) {
    throw new Error(
      `The run succeeded, but its NCBI cache was not recorded in the accession catalog: ${
        error instanceof Error ? error.message : String(error)}`,
    );
  }
  return `Recorded the NCBI accession cache under ${outputRoot} in the accession catalog.`;
}

function previousRunFormValues(configuration: ReferenceConsensusConfiguration): WorkflowFormValues {
  const {backbone, selected_isolates} = configuration.inputs;
  return {
    'backbone-source': backbone.source,
    'backbone-fasta': backbone.source === 'local' ? backbone.fasta : '',
    'backbone-accession': backbone.source === 'ncbi' ? backbone.accession : '',
    isolates: selected_isolates.join(','),
    'voting-method': configuration.consensus.voting_method,
    'include-backbone-vote': configuration.consensus.include_backbone_vote ? 'yes' : 'no',
    'min-callable-isolates': String(configuration.consensus.min_callable_isolates),
    'unresolved-snp': configuration.consensus.unresolved_snp,
    'min-depth': String(configuration.calling.min_depth),
    'min-mapping-quality': String(configuration.calling.min_mapping_quality),
    'min-base-quality': String(configuration.calling.min_base_quality),
    'min-allele-fraction': String(configuration.calling.min_allele_fraction),
    'cpu-allocation': configuration.resources.cpu_mode,
    'manual-cpu-limit': String(configuration.resources.manual_limit ?? ''),
    'output-root': configuration.run.output_root,
    'run-name': configuration.run.name ?? '',
    'run-description': configuration.run.description ?? '',
  };
}

async function defaultDiscoverPreviousRuns(currentDirectory: string): ReturnType<PreviousRunsLoader> {
  const records = await discoverReferenceConsensusRuns(resolve(currentDirectory, 'runs'));
  return records.map(record => ({
    label: previousRunLabel(record.configuration),
    values: previousRunFormValues(record.configuration),
  }));
}

function draftFromValues(values: WorkflowFormValues, currentDirectory: string): ReferenceConsensusDraft {
  const cpuMode = values['cpu-allocation'];
  return {
    backboneSource: values['backbone-source'] === 'local' ? 'local' : 'ncbi',
    backboneFasta: values['backbone-fasta'] ?? '',
    backboneAccession: values['backbone-accession'] ?? '',
    isolateIds: parseIsolateSelection(values.isolates ?? ''),
    votingMethod: values['voting-method'] === 'plurality' ? 'plurality' : 'strict-majority',
    includeBackboneVote: values['include-backbone-vote'] !== 'no',
    minCallableIsolates: values['min-callable-isolates'] ?? '',
    unresolvedSnp: values['unresolved-snp'] === 'iupac' ? 'iupac' : 'n',
    minDepth: values['min-depth'] ?? '',
    minMappingQuality: values['min-mapping-quality'] ?? '',
    minBaseQuality: values['min-base-quality'] ?? '',
    minAlleleFraction: values['min-allele-fraction'] ?? '',
    cpuMode: cpuMode === 'leave-one-free' || cpuMode === 'manual' ? cpuMode : 'automatic',
    manualCpuLimit: values['manual-cpu-limit'] ?? '',
    outputRoot: values['output-root'] ?? resolve(currentDirectory, 'runs'),
    runName: values['run-name'] ?? '',
    runDescription: values['run-description'] ?? '',
  };
}

/** Values the review shows for the form's own fields, where they differ from what was typed. */
function resolvedValues(prepared: PreparedReferenceConsensusRun): WorkflowFormValues {
  const {configuration, snapshot} = prepared;
  const {backbone} = configuration.inputs;
  return {
    'backbone-fasta': backbone.source === 'local' ? backbone.fasta : '',
    'backbone-accession': backbone.source === 'ncbi' ? backbone.accession : '',
    isolates: `${String(snapshot.isolates.length)} selected, listed below`,
    'min-allele-fraction': String(configuration.calling.min_allele_fraction),
    'output-root': configuration.run.output_root,
  };
}

function backboneSection(prepared: PreparedReferenceConsensusRun, inspection: RunInspection): ReviewSection {
  const {backbone} = prepared.configuration.inputs;
  if (backbone.source === 'local') {
    return {
      id: 'backbone',
      title: 'Backbone',
      rows: [
        {label: 'Name', value: basename(backbone.fasta)},
        {label: 'Source', value: 'Local file, copied into the run directory'},
        {label: 'Path', value: backbone.fasta},
        {label: 'Checksum', value: 'Computed when the backbone is resolved'},
      ],
    };
  }
  const entry = inspection.backboneEntry;
  const copies = entry && recordedCacheState(entry) === 'cached' ? entry.cached_copies : [];
  const facts = entry?.ncbi;
  return {
    id: 'backbone',
    title: 'Backbone',
    rows: [
      {label: 'Name', value: entry ? accessionDisplayName(entry) : 'Not in the accession catalog'},
      {label: 'Source', value: 'NCBI accession'},
      {label: 'Accession', value: backbone.accession},
      ...(facts ? [{label: 'Organism', value: facts.organism}] : []),
      ...(facts?.strain ? [{label: 'Strain', value: facts.strain}] : []),
      {
        label: 'Cache',
        value: backbone.ncbi_cache_mode === 'refresh'
          ? 'Download a fresh copy'
          : 'Reuse the cache after checksum verification when available, otherwise download',
      },
      {
        label: 'FASTA checksum',
        value: copies[0] ? `sha256 ${copies[0].fasta_sha256}` : 'Not known yet; recorded when downloaded',
      },
    ],
  };
}

function isolatesSection(prepared: PreparedReferenceConsensusRun): ReviewSection {
  const {isolates} = prepared.snapshot;
  const pairCount = isolates.reduce((total, isolate) => total + isolate.read_pairs.length, 0);
  return {
    id: 'isolates',
    title: `Isolates (${String(isolates.length)}, ${String(pairCount)} read pair${pairCount === 1 ? '' : 's'})`,
    rows: isolates.flatMap(isolate => [
      {
        label: `${isolate.name} (${isolate.id})`,
        value: `${String(isolate.read_pairs.length)} read pair${isolate.read_pairs.length === 1 ? '' : 's'} · ` +
          `${trimmedStatus(isolate)} · ${lineage(isolate)}`,
      },
      ...isolate.read_pairs.map((pair, index) => ({
        label: `  pair ${String(index + 1)}`,
        value: `${basename(pair.r1)} / ${basename(pair.r2)}${pair.trimmed ? ' · trimmed' : ''}`,
      })),
    ]),
  };
}

const votingExplanations: Record<VotingMethod, string> = {
  'strict-majority': 'An allele (a base, or an inserted or deleted sequence) wins only with more than half ' +
    'of all votes cast at a position.',
  plurality: 'The allele (a base, or an inserted or deleted sequence) with the unique highest vote count wins.',
};

/** Outcome of a set of votes under a voting method; a tie for first place is never resolved. */
function votingOutcome(votes: readonly string[], method: VotingMethod): string {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote, (counts.get(vote) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [first, second] = ranked;
  if (!first || (second && second[1] === first[1])) {
    return 'unresolved';
  }
  if (method === 'strict-majority' && first[1] * 2 <= votes.length) {
    return 'unresolved';
  }
  return first[0];
}

// Vote sets chosen to show where the two methods agree and where they differ.
const votingExamples: readonly (readonly string[])[] = [
  ['A', 'A', 'A', 'G', 'T'],
  ['A', 'A', 'G', 'T', 'C'],
  ['A', 'A', 'G', 'G', 'T'],
];

function votingSection(configuration: ReferenceConsensusConfiguration): ReviewSection {
  const method = configuration.consensus.voting_method;
  const includeBackbone = configuration.consensus.include_backbone_vote;
  const minimum = configuration.consensus.min_callable_isolates;
  return {
    id: 'voting',
    title: 'Voting',
    rows: [
      {label: 'Method', value: votingExplanations[method]},
      {
        label: 'Votes',
        value: includeBackbone
          ? 'The backbone casts one vote; each callable isolate casts one. Uncallable isolates do not vote.'
          : 'Only callable isolates vote; the backbone supplies the coordinates.',
      },
      {
        label: 'Minimum',
        value: minimum === 0
          ? 'No minimum of callable isolates; a position without any vote is written as N.'
          : `A position needs ${String(minimum)} voting isolate${minimum === 1 ? '' : 's'}; below that it is written as N.`,
      },
      {
        label: 'Unresolved',
        value: (configuration.consensus.unresolved_snp === 'iupac'
          ? 'An unresolved SNP is written as the IUPAC code of its voted alleles (A or G is R); '
          : 'An unresolved SNP is written as N; ') +
          'an unresolved indel as N over its backbone span.',
      },
      ...votingExamples.map((votes, index) => ({
        label: `Example ${String(index + 1)}`,
        value: `${votes.map((vote, position) => includeBackbone && position === 0 ? `${vote} (backbone)` : vote).join(', ')}` +
          ` → strict majority: ${votingOutcome(votes, 'strict-majority')}, plurality: ${votingOutcome(votes, 'plurality')}`,
      })),
    ],
  };
}

export function ReferenceConsensusConfigurationScreen({
  currentDirectory,
  onBack,
  inputActive,
  genopilot,
  availableCpus,
  parameterDefinitions = [],
  stages = [],
  manifest,
  loadIsolateCatalogSnapshot = defaultLoadIsolateCatalog,
  loadIsolates,
  inspectRun = prepared => inspectPreparedRun(prepared),
  saveRun = prepared => savePreparedRun(prepared),
  checkBackboneCache = prepared => hasBackboneCacheEntry(prepared),
  checkNcbiApiKey = defaultNcbiApiKeyCheck,
  discoverPreviousRuns = defaultDiscoverPreviousRuns,
  snakefilePath,
  prepareSnakemakeRun = defaultPrepareSnakemakeRun,
  executeSnakemakeRun = defaultExecuteSnakemakeRun,
  registerAccessionCaches = defaultRegisterAccessionCaches,
}: {
  currentDirectory: string;
  onBack: () => void;
  inputActive: boolean;
  /** The running GenoPilot, saved in every configuration this screen writes. */
  genopilot: GenoPilotDetails;
  availableCpus?: number;
  parameterDefinitions?: readonly WorkflowParameterDefinition[];
  stages?: readonly WorkflowStage[];
  manifest?: WorkflowManifest;
  /** The whole catalog, read when the run is prepared, so the snapshot copies current records. */
  loadIsolateCatalogSnapshot?: IsolateCatalogSnapshotLoader;
  /** The isolates the picker offers. */
  loadIsolates?: IsolateCatalogReader;
  inspectRun?: ReferenceConsensusRunInspector;
  saveRun?: ReferenceConsensusRunSaver;
  checkBackboneCache?: BackboneCacheCheck;
  checkNcbiApiKey?: NcbiApiKeyCheck;
  discoverPreviousRuns?: PreviousRunsLoader;
  /** The workflow's entry Snakefile, from its discovered directory. */
  snakefilePath: string;
  prepareSnakemakeRun?: typeof defaultPrepareSnakemakeRun;
  executeSnakemakeRun?: typeof defaultExecuteSnakemakeRun;
  registerAccessionCaches?: AccessionCacheRegistration;
}): React.JSX.Element {
  const [previousRuns, setPreviousRuns] = useState<Awaited<ReturnType<PreviousRunsLoader>>>([]);

  useEffect(() => {
    let active = true;
    discoverPreviousRuns(currentDirectory).then(
      runs => {
        if (active) {
          setPreviousRuns(runs);
        }
      },
      () => {
        if (active) {
          setPreviousRuns([]);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [discoverPreviousRuns, currentDirectory]);

  const snakemakeRun = (mode: 'dry-run' | 'execute', prepared: PreparedReferenceConsensusRun, configurationPath: string) =>
    prepareSnakemakeRun({
      mode,
      runDirectory: prepared.outputDirectory,
      configurationPath,
      snakefilePath,
      cores: prepared.configuration.resources.effective_cpus,
    });

  const prepareRun = async (
    values: WorkflowFormValues,
  ): Promise<PreparedWorkflowRun<PreparedReferenceConsensusRun>> => {
    const catalog = await loadIsolateCatalogSnapshot();
    const prepared = buildReferenceConsensusRun(
      draftFromValues(values, currentDirectory),
      catalog,
      currentDirectory,
      genopilot,
      availableCpus,
    );
    const inspection = await inspectRun(prepared);
    const usesNcbi = prepared.configuration.inputs.backbone.source === 'ncbi';
    const apiKeyConfigured = usesNcbi ? await checkNcbiApiKey() : false;
    const cached = usesNcbi ? await checkBackboneCache(prepared) : false;

    const prepareForReview = (
      run: PreparedReferenceConsensusRun,
    ): PreparedWorkflowRun<PreparedReferenceConsensusRun> => {
      const {calling, resources} = run.configuration;
      const effectiveOptions = [
        {label: 'Run ID', value: run.configuration.run.id},
        {label: 'Ploidy', value: `${String(calling.ploidy)} (haploid)`},
        {label: 'Effective CPUs', value: String(resources.effective_cpus)},
        ...(usesNcbi
          ? [{
              label: 'NCBI API key',
              value: apiKeyConfigured ? 'Configured' : 'Not set (rate-limited) — add one in Manage NCBI accessions',
            }]
          : []),
      ];
      return {
        payload: run,
        resolvedValues: resolvedValues(run),
        details: [backboneSection(run, inspection), isolatesSection(run), votingSection(run.configuration)],
        warnings: reviewWarnings(run, inspection),
        effectiveOptions,
        outputDirectory: run.outputDirectory,
      };
    };

    const review = prepareForReview(prepared);
    if (!cached) {
      return review;
    }
    const {backbone} = prepared.configuration.inputs;
    return {
      ...review,
      ncbiCache: {
        entries: [{
          id: 'backbone',
          label: `Backbone ${backbone.source === 'ncbi' ? backbone.accession : ''}`,
        }],
        apply: modes => prepareForReview(applyBackboneCacheMode(prepared, modes.backbone ?? 'reuse')),
      },
    };
  };

  return (
    <WorkflowConfigurationScreen
      title={manifest?.label ?? 'Unnamed Workflow'}
      currentDirectory={currentDirectory}
      parameterDefinitions={parameterDefinitions}
      stages={stages}
      onBack={onBack}
      inputActive={inputActive}
      prepareRun={prepareRun}
      saveRun={saveRun}
      previousRuns={previousRuns}
      prepareSnakemakeRun={snakemakeRun}
      executeSnakemakeRun={(run, onOutput, signal) =>
        executeSnakemakeRun(run, onOutput as (output: WorkflowOutput) => void, signal)
      }
      resultManifest={manifest}
      resultCohortRerun={{snakefilePath}}
      executionIsolates={prepared => prepared.snapshot.isolates.map(isolate => ({
        id: isolate.id,
        label: isolate.name,
        readPairs: isolate.read_pairs.length,
      }))}
      completedIsolates={prepared => completedIsolates(
        prepared.outputDirectory,
        prepared.snapshot.isolates.map(isolate => isolate.id),
      )}
      onRunSucceeded={prepared => prepared.configuration.inputs.backbone.source === 'ncbi'
        ? {
          label: 'Recording the NCBI accession cache in the accession catalog…',
          outcome: registerAccessionCaches(prepared.configuration.run.output_root, currentDirectory),
        }
        : undefined}
      {...(loadIsolates ? {loadIsolates} : {})}
    />
  );
}
