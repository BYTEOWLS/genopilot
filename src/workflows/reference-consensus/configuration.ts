import {parse} from 'yaml';
import {isolateIdPattern} from '../../isolates/catalog.js';
import {
  isRecord,
  rejectUnknownFields,
  requireObject,
  validateAbsolutePath,
  validateAccession,
  validateInputSource,
  validateNcbiCacheMode,
  validateResources,
  validateRun,
  validateWorkflowIdentity,
  type ConfigurationValidationIssue,
  type NcbiCacheMode,
  type ResourceSettings,
  type RunDetails,
} from '../configuration-validation.js';

export const REFERENCE_CONSENSUS_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const REFERENCE_CONSENSUS_WORKFLOW_ID = 'reference-consensus' as const;
export const REFERENCE_CONSENSUS_WORKFLOW_VERSION = 1 as const;
/** The run-relative file holding the selected isolates' snapshot. */
export const ISOLATE_SNAPSHOT_FILENAME = 'isolates.yaml' as const;

export type VotingMethod = 'strict-majority' | 'plurality';
export const votingMethods: readonly VotingMethod[] = ['strict-majority', 'plurality'];

export type BackboneInput =
  | {source: 'local'; fasta: string}
  | {source: 'ncbi'; accession: string; ncbi_cache_mode?: NcbiCacheMode};

/**
 * Per-isolate callability and calling thresholds. Only haploid calling is supported; the ploidy
 * is saved anyway so a run states it explicitly rather than relying on a tool default.
 */
export type CallingSettings = {
  ploidy: 1;
  min_depth: number;
  min_mapping_quality: number;
  min_base_quality: number;
  min_allele_fraction: number;
};

export const defaultCallingSettings: CallingSettings = {
  ploidy: 1,
  min_depth: 10,
  min_mapping_quality: 20,
  min_base_quality: 20,
  min_allele_fraction: 0.8,
};

export type ReferenceConsensusConfiguration = {
  schema_version: typeof REFERENCE_CONSENSUS_CONFIGURATION_SCHEMA_VERSION;
  workflow_id: typeof REFERENCE_CONSENSUS_WORKFLOW_ID;
  workflow_version: typeof REFERENCE_CONSENSUS_WORKFLOW_VERSION;
  inputs: {
    backbone: BackboneInput;
    isolates_file: typeof ISOLATE_SNAPSHOT_FILENAME;
    selected_isolates: string[];
  };
  calling: CallingSettings;
  consensus: {
    include_backbone_vote: boolean;
    voting_method: VotingMethod;
  };
  resources: ResourceSettings;
  run: RunDetails;
};

export class ReferenceConsensusConfigurationError extends Error {
  readonly issues: readonly ConfigurationValidationIssue[];

  constructor(issues: ConfigurationValidationIssue[]) {
    super(
      `Invalid reference-consensus configuration:\n${issues
        .map(issue => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ReferenceConsensusConfigurationError';
    this.issues = issues;
  }
}

function validateBackbone(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): BackboneInput | undefined {
  const path = '$.inputs.backbone';
  const backbone = requireObject(value, path, issues);
  if (!backbone) {
    return undefined;
  }
  const source = validateInputSource(backbone.source, path, issues);
  if (source === 'local') {
    rejectUnknownFields(backbone, ['source', 'fasta'], path, issues);
    return validateAbsolutePath(backbone.fasta, `${path}.fasta`, issues)
      ? (backbone as BackboneInput)
      : undefined;
  }
  if (source === 'ncbi') {
    rejectUnknownFields(backbone, ['source', 'accession', 'ncbi_cache_mode'], path, issues);
    return validateAccession(backbone.accession, `${path}.accession`, issues) &&
      validateNcbiCacheMode(backbone, path, issues)
      ? (backbone as BackboneInput)
      : undefined;
  }
  return undefined;
}

function validateSelectedIsolates(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): string[] | undefined {
  const path = '$.inputs.selected_isolates';
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({path, message: 'must list at least one isolate ID'});
    return undefined;
  }
  let valid = true;
  const seen = new Set<string>();
  value.forEach((id, index) => {
    if (typeof id !== 'string' || !isolateIdPattern.test(id)) {
      issues.push({path: `${path}[${index}]`, message: 'must be an isolate ID'});
      valid = false;
    } else if (seen.has(id)) {
      issues.push({path: `${path}[${index}]`, message: `selects '${id}' more than once`});
      valid = false;
    } else {
      seen.add(id);
    }
  });
  return valid ? (value as string[]) : undefined;
}

function validateInputs(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): ReferenceConsensusConfiguration['inputs'] | undefined {
  const inputs = requireObject(value, '$.inputs', issues);
  if (!inputs) {
    return undefined;
  }
  rejectUnknownFields(inputs, ['backbone', 'isolates_file', 'selected_isolates'], '$.inputs', issues);
  const backbone = validateBackbone(inputs.backbone, issues);
  let validFile = true;
  if (inputs.isolates_file !== ISOLATE_SNAPSHOT_FILENAME) {
    issues.push({path: '$.inputs.isolates_file', message: `must equal '${ISOLATE_SNAPSHOT_FILENAME}'`});
    validFile = false;
  }
  const selected = validateSelectedIsolates(inputs.selected_isolates, issues);
  if (!backbone || !validFile || !selected) {
    return undefined;
  }
  return {backbone, isolates_file: ISOLATE_SNAPSHOT_FILENAME, selected_isolates: selected};
}

function validateInteger(
  value: unknown,
  path: string,
  minimum: number,
  issues: ConfigurationValidationIssue[],
): boolean {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    issues.push({path, message: `must be an integer of at least ${String(minimum)}`});
    return false;
  }
  return true;
}

/** Whether an allele fraction is strict enough that a haploid call has a single clear winner. */
export function isValidAlleleFraction(value: number): boolean {
  return Number.isFinite(value) && value > 0.5 && value <= 1;
}

function validateCalling(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): CallingSettings | undefined {
  const calling = requireObject(value, '$.calling', issues);
  if (!calling) {
    return undefined;
  }
  rejectUnknownFields(
    calling,
    ['ploidy', 'min_depth', 'min_mapping_quality', 'min_base_quality', 'min_allele_fraction'],
    '$.calling',
    issues,
  );
  let valid = true;
  if (calling.ploidy !== 1) {
    issues.push({path: '$.calling.ploidy', message: 'must equal 1; only haploid calling is supported'});
    valid = false;
  }
  valid = validateInteger(calling.min_depth, '$.calling.min_depth', 1, issues) && valid;
  valid = validateInteger(calling.min_mapping_quality, '$.calling.min_mapping_quality', 0, issues) && valid;
  valid = validateInteger(calling.min_base_quality, '$.calling.min_base_quality', 0, issues) && valid;
  if (typeof calling.min_allele_fraction !== 'number' || !isValidAlleleFraction(calling.min_allele_fraction)) {
    issues.push({
      path: '$.calling.min_allele_fraction',
      message: 'must be a number greater than 0.5 and at most 1',
    });
    valid = false;
  }
  return valid ? (calling as CallingSettings) : undefined;
}

function validateConsensus(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): ReferenceConsensusConfiguration['consensus'] | undefined {
  const consensus = requireObject(value, '$.consensus', issues);
  if (!consensus) {
    return undefined;
  }
  rejectUnknownFields(consensus, ['include_backbone_vote', 'voting_method'], '$.consensus', issues);
  let valid = true;
  if (typeof consensus.include_backbone_vote !== 'boolean') {
    issues.push({path: '$.consensus.include_backbone_vote', message: 'must be true or false'});
    valid = false;
  }
  if (!votingMethods.includes(consensus.voting_method as VotingMethod)) {
    issues.push({
      path: '$.consensus.voting_method',
      message: `must be one of: ${votingMethods.join(', ')}`,
    });
    valid = false;
  }
  return valid ? (consensus as ReferenceConsensusConfiguration['consensus']) : undefined;
}

export function validateReferenceConsensusConfiguration(
  value: unknown,
): ReferenceConsensusConfiguration {
  const issues: ConfigurationValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new ReferenceConsensusConfigurationError([{path: '$', message: 'must be an object'}]);
  }
  rejectUnknownFields(
    value,
    ['schema_version', 'workflow_id', 'workflow_version', 'inputs', 'calling', 'consensus', 'resources', 'run'],
    '$',
    issues,
  );
  validateWorkflowIdentity(value, {
    schemaVersion: REFERENCE_CONSENSUS_CONFIGURATION_SCHEMA_VERSION,
    workflowId: REFERENCE_CONSENSUS_WORKFLOW_ID,
    workflowVersion: REFERENCE_CONSENSUS_WORKFLOW_VERSION,
  }, issues);

  const inputs = validateInputs(value.inputs, issues);
  const calling = validateCalling(value.calling, issues);
  const consensus = validateConsensus(value.consensus, issues);
  const resources = validateResources(value.resources, issues);
  const run = validateRun(value.run, issues);

  if (issues.length > 0 || !inputs || !calling || !consensus || !resources || !run) {
    throw new ReferenceConsensusConfigurationError(issues);
  }
  return {
    schema_version: REFERENCE_CONSENSUS_CONFIGURATION_SCHEMA_VERSION,
    workflow_id: REFERENCE_CONSENSUS_WORKFLOW_ID,
    workflow_version: REFERENCE_CONSENSUS_WORKFLOW_VERSION,
    inputs,
    calling,
    consensus,
    resources,
    run,
  };
}

export function parseReferenceConsensusConfiguration(source: string): ReferenceConsensusConfiguration {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReferenceConsensusConfigurationError([
      {path: '$', message: `is not valid YAML: ${detail}`},
    ]);
  }
  return validateReferenceConsensusConfiguration(value);
}
