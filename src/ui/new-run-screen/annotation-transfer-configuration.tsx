import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import React, {useEffect, useState} from 'react';
import {scanAccessionCaches} from '../../accessions/cache-discovery.js';
import {refreshAccessionCaches} from '../../accessions/registration.js';
import {loadAccessionCatalog, updateAccessionCatalog} from '../../accessions/store.js';
import {isNcbiApiKeyConfigured} from '../../tooling/ncbi-api-key.js';
import {resolveToolingPaths} from '../../tooling/paths.js';
import type {AnnotationTransferConfiguration} from '../../workflows/annotation-transfer/configuration.js';
import type {RunDetails} from '../../workflows/configuration-validation.js';
import type {WorkflowParameterDefinition} from '../../workflows/parameter-definitions.js';
import {
  executeSnakemakeRun as defaultExecuteSnakemakeRun,
  prepareSnakemakeRun as defaultPrepareSnakemakeRun,
  type WorkflowOutput,
} from '../../workflows/execution.js';
import {
  applyNcbiCacheModes,
  buildAnnotationTransferConfiguration,
  createAnnotationTransferDraft,
  discoverAnnotationTransferRuns,
  findNcbiCacheEntries,
  savePreparedRun,
  validatePreparedRunPaths,
  type AnnotationTransferConfigurationDraft,
  type NcbiCacheEntry,
  type PreparedAnnotationTransferRun,
} from '../../workflows/annotation-transfer/run-configuration.js';
import type {WorkflowManifest, WorkflowStage} from '../../workflows/manifest.js';
import WorkflowConfigurationScreen, {
  type PreparedWorkflowRun,
  type PreviousWorkflowRun,
  type WorkflowFormValues,
} from './workflow-configuration.js';

export type PreparedRunValidator = (prepared: PreparedAnnotationTransferRun) => Promise<void>;
export type PreparedRunSaver = (prepared: PreparedAnnotationTransferRun) => Promise<string>;
export type NcbiApiKeyCheck = () => Promise<boolean>;
export type PreviousRunsLoader = (currentDirectory: string) => Promise<readonly PreviousWorkflowRun[]>;
export type NcbiCacheEntryFinder = (
  prepared: PreparedAnnotationTransferRun,
) => Promise<readonly NcbiCacheEntry[]>;
/** Records the NCBI caches under a finished run's output root in the accession catalog. */
export type AccessionCacheRegistration = (outputRoot: string, currentDirectory: string) => Promise<string>;

const packagedSnakefilePath = fileURLToPath(
  new URL('../../../workflows/annotation-transfer/Snakefile', import.meta.url),
);

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

function usesNcbiInput(prepared: PreparedAnnotationTransferRun): boolean {
  return prepared.configuration.inputs.reference.source === 'ncbi' ||
    prepared.configuration.inputs.target.source === 'ncbi';
}

function previousRunFormValues(configuration: AnnotationTransferConfiguration): WorkflowFormValues {
  const {reference, target} = configuration.inputs;
  return {
    'reference-source': reference.source,
    'reference-fasta': reference.source === 'local' ? reference.fasta : '',
    'reference-gff3': reference.source === 'local' ? reference.gff3 : '',
    'reference-accession': reference.source === 'ncbi' ? reference.accession : '',
    'target-source': target.source,
    'target-fasta': target.source === 'local' ? target.fasta : '',
    'target-accession': target.source === 'ncbi' ? target.accession : '',
    'minimum-protein-identity': String(configuration.review.minimum_protein_identity),
    'cpu-allocation': configuration.resources.cpu_mode,
    'manual-cpu-limit': String(configuration.resources.manual_limit ?? ''),
    'output-root': configuration.run.output_root,
    'run-name': configuration.run.name ?? '',
    'run-description': configuration.run.description ?? '',
  };
}

/**
 * Labels a saved run for the prefill picker by what the researcher recognizes it as — its
 * optional name and its creation time — rather than by the run ID, whose timestamp prefix and
 * sanitized directory form are hard to read here. The time is shown exactly as
 * `run.created_at` records it, in UTC, so it never disagrees with the saved configuration.
 */
export function previousRunLabel(configuration: {run: RunDetails}): string {
  const createdAt = `${configuration.run.created_at.replace('T', ' ').slice(0, 19)} UTC`;
  return [configuration.run.name, createdAt, configuration.run.description]
    .filter(Boolean)
    .join(' — ');
}

async function defaultDiscoverPreviousRuns(
  currentDirectory: string,
): Promise<readonly PreviousWorkflowRun[]> {
  const records = await discoverAnnotationTransferRuns(resolve(currentDirectory, 'runs'));
  return records.map(record => ({
    label: previousRunLabel(record.configuration),
    values: previousRunFormValues(record.configuration),
  }));
}

function annotationTransferDraft(
  values: WorkflowFormValues,
  currentDirectory: string,
): AnnotationTransferConfigurationDraft {
  return {
    ...createAnnotationTransferDraft(currentDirectory),
    referenceSource: values['reference-source'] === 'ncbi' ? 'ncbi' : 'local',
    referenceFasta: values['reference-fasta'] ?? '',
    referenceGff3: values['reference-gff3'] ?? '',
    referenceAccession: values['reference-accession'] ?? '',
    targetSource: values['target-source'] === 'ncbi' ? 'ncbi' : 'local',
    targetFasta: values['target-fasta'] ?? '',
    targetAccession: values['target-accession'] ?? '',
    minimumProteinIdentity: values['minimum-protein-identity'] ?? '',
    cpuMode:
      values['cpu-allocation'] === 'leave-one-free' ||
      values['cpu-allocation'] === 'manual'
        ? values['cpu-allocation']
        : 'automatic',
    manualCpuLimit: values['manual-cpu-limit'] ?? '',
    outputRoot: values['output-root'] ?? '',
    runName: values['run-name'] ?? '',
    runDescription: values['run-description'] ?? '',
  };
}

function resolvedValues(
  prepared: PreparedAnnotationTransferRun,
): WorkflowFormValues {
  const configuration = prepared.configuration;
  const {reference, target} = configuration.inputs;
  return {
    // 'reference-source'/'target-source' are intentionally omitted so the review screen falls
    // back to the choice field's own friendly label ("Local file"/"NCBI accession") instead of
    // the raw 'local'/'ncbi' value.
    'reference-fasta': reference.source === 'local' ? reference.fasta : '',
    'reference-gff3': reference.source === 'local' ? reference.gff3 : '',
    'reference-accession': reference.source === 'ncbi' ? reference.accession : '',
    'target-fasta': target.source === 'local' ? target.fasta : '',
    'target-accession': target.source === 'ncbi' ? target.accession : '',
    'lifton-profile': configuration.lifton.profile,
    'minimum-protein-identity': String(configuration.review.minimum_protein_identity),
    'cpu-allocation': configuration.resources.cpu_mode,
    'manual-cpu-limit': String(configuration.resources.manual_limit ?? ''),
    'output-root': configuration.run.output_root,
    'run-name': configuration.run.name ?? '',
    'run-description': configuration.run.description ?? '',
  };
}

export function AnnotationTransferConfigurationScreen({
  currentDirectory,
  onBack,
  inputActive,
  availableCpus,
  validatePreparedRun = validatePreparedRunPaths,
  saveRun = savePreparedRun,
  parameterDefinitions = [],
  stages = [],
  checkNcbiApiKey = defaultNcbiApiKeyCheck,
  discoverPreviousRuns = defaultDiscoverPreviousRuns,
  findCacheEntries = findNcbiCacheEntries,
  snakefilePath = packagedSnakefilePath,
  prepareSnakemakeRun = defaultPrepareSnakemakeRun,
  executeSnakemakeRun = defaultExecuteSnakemakeRun,
  registerAccessionCaches = defaultRegisterAccessionCaches,
  manifest,
}: {
  currentDirectory: string;
  onBack: () => void;
  inputActive: boolean;
  availableCpus?: number;
  validatePreparedRun?: PreparedRunValidator;
  saveRun?: PreparedRunSaver;
  parameterDefinitions?: readonly WorkflowParameterDefinition[];
  stages?: readonly WorkflowStage[];
  checkNcbiApiKey?: NcbiApiKeyCheck;
  discoverPreviousRuns?: PreviousRunsLoader;
  findCacheEntries?: NcbiCacheEntryFinder;
  snakefilePath?: string;
  prepareSnakemakeRun?: typeof defaultPrepareSnakemakeRun;
  executeSnakemakeRun?: typeof defaultExecuteSnakemakeRun;
  registerAccessionCaches?: AccessionCacheRegistration;
  manifest?: WorkflowManifest;
}): React.JSX.Element {
  const [previousRuns, setPreviousRuns] = useState<readonly PreviousWorkflowRun[]>([]);

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

  const prepareRun = async (
    values: WorkflowFormValues,
  ): Promise<PreparedWorkflowRun<PreparedAnnotationTransferRun>> => {
    const prepared = buildAnnotationTransferConfiguration(
      annotationTransferDraft(values, currentDirectory),
      currentDirectory,
      availableCpus,
    );
    await validatePreparedRun(prepared);
    const usesNcbi = usesNcbiInput(prepared);
    const apiKeyConfigured = usesNcbi ? await checkNcbiApiKey() : false;
    const cacheEntries = usesNcbi ? await findCacheEntries(prepared) : [];

    const prepareForReview = (
      run: PreparedAnnotationTransferRun,
    ): PreparedWorkflowRun<PreparedAnnotationTransferRun> => {
      const effectiveOptions = [
        {label: 'Run ID', value: run.configuration.run.id},
        {label: 'Effective CPUs', value: String(run.configuration.resources.effective_cpus)},
      ];
      if (usesNcbi) {
        effectiveOptions.push({
          label: 'NCBI API key',
          value: apiKeyConfigured
            ? 'Configured'
            : 'Not set (rate-limited) — add one in Manage NCBI accessions',
        });
        for (const input of ['reference', 'target'] as const) {
          const configuredInput = run.configuration.inputs[input];
          if (configuredInput.source === 'ncbi') {
            effectiveOptions.push({
              label: `${input === 'reference' ? 'Reference' : 'Target'} NCBI cache`,
              value:
                configuredInput.ncbi_cache_mode === 'refresh'
                  ? 'Download fresh copy'
                  : 'Reuse cache after checksum verification when available',
            });
          }
        }
      }
      return {
        payload: run,
        resolvedValues: resolvedValues(run),
        effectiveOptions,
        outputDirectory: run.outputDirectory,
      };
    };

    const review = prepareForReview(prepared);
    if (cacheEntries.length === 0) {
      return review;
    }
    return {
      ...review,
      ncbiCache: {
        entries: cacheEntries.map(entry => ({
          id: entry.input,
          label: `${entry.input === 'reference' ? 'Reference' : 'Target'} ${entry.accession}`,
        })),
        apply: modes =>
          prepareForReview(applyNcbiCacheModes(prepared, {reference: modes.reference, target: modes.target})),
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
      prepareSnakemakeRun={(mode, prepared, configurationPath) =>
        prepareSnakemakeRun({
          mode,
          runDirectory: prepared.outputDirectory,
          configurationPath,
          snakefilePath,
          cores: prepared.configuration.resources.effective_cpus,
        })
      }
      executeSnakemakeRun={(run, onOutput, signal) =>
        executeSnakemakeRun(run, onOutput as (output: WorkflowOutput) => void, signal)
      }
      resultManifest={manifest}
      onRunSucceeded={prepared => usesNcbiInput(prepared)
        ? {
          label: 'Recording the NCBI accession cache in the accession catalog…',
          outcome: registerAccessionCaches(prepared.configuration.run.output_root, currentDirectory),
        }
        : undefined}
    />
  );
}
