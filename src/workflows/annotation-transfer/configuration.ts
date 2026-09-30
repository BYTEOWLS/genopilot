import {parse} from 'yaml';
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
  type CpuMode,
  type NcbiCacheMode,
  type ResourceSettings,
  type RunDetails,
} from '../configuration-validation.js';

export type {ConfigurationValidationIssue, CpuMode, NcbiCacheMode};

export const ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const ANNOTATION_TRANSFER_WORKFLOW_ID = 'annotation-transfer' as const;
export const ANNOTATION_TRANSFER_WORKFLOW_VERSION = 1 as const;

type NcbiInput = {source: 'ncbi'; accession: string; ncbi_cache_mode?: NcbiCacheMode};

export type ReferenceInput =
  | {source: 'local'; fasta: string; gff3: string}
  | NcbiInput;

export type TargetInput = {source: 'local'; fasta: string} | NcbiInput;

export type AnnotationTransferConfiguration = {
  schema_version: typeof ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION;
  workflow_id: typeof ANNOTATION_TRANSFER_WORKFLOW_ID;
  workflow_version: typeof ANNOTATION_TRANSFER_WORKFLOW_VERSION;
  inputs: {
    reference: ReferenceInput;
    target: TargetInput;
  };
  lifton: {
    profile: 'same-species';
  };
  resources: ResourceSettings;
  run: RunDetails;
};

export class AnnotationTransferConfigurationError extends Error {
  readonly issues: readonly ConfigurationValidationIssue[];

  constructor(issues: ConfigurationValidationIssue[]) {
    super(
      `Invalid annotation-transfer configuration:\n${issues
        .map(issue => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'AnnotationTransferConfigurationError';
    this.issues = issues;
  }
}

function validateReferenceInput(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): ReferenceInput | undefined {
  const path = '$.inputs.reference';
  const reference = requireObject(value, path, issues);
  if (!reference) {
    return undefined;
  }
  const source = validateInputSource(reference.source, path, issues);
  if (source === 'local') {
    rejectUnknownFields(reference, ['source', 'fasta', 'gff3'], path, issues);
    const validFasta = validateAbsolutePath(reference.fasta, `${path}.fasta`, issues);
    const validGff3 = validateAbsolutePath(reference.gff3, `${path}.gff3`, issues);
    return validFasta && validGff3 ? (reference as ReferenceInput) : undefined;
  }
  if (source === 'ncbi') {
    rejectUnknownFields(reference, ['source', 'accession', 'ncbi_cache_mode'], path, issues);
    return validateAccession(reference.accession, `${path}.accession`, issues) &&
      validateNcbiCacheMode(reference, path, issues)
      ? (reference as ReferenceInput)
      : undefined;
  }
  return undefined;
}

function validateTargetInput(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): TargetInput | undefined {
  const path = '$.inputs.target';
  const target = requireObject(value, path, issues);
  if (!target) {
    return undefined;
  }
  const source = validateInputSource(target.source, path, issues);
  if (source === 'local') {
    rejectUnknownFields(target, ['source', 'fasta'], path, issues);
    return validateAbsolutePath(target.fasta, `${path}.fasta`, issues)
      ? (target as TargetInput)
      : undefined;
  }
  if (source === 'ncbi') {
    rejectUnknownFields(target, ['source', 'accession', 'ncbi_cache_mode'], path, issues);
    return validateAccession(target.accession, `${path}.accession`, issues) &&
      validateNcbiCacheMode(target, path, issues)
      ? (target as TargetInput)
      : undefined;
  }
  return undefined;
}

function validateInputs(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): AnnotationTransferConfiguration['inputs'] | undefined {
  const inputs = requireObject(value, '$.inputs', issues);
  if (!inputs) {
    return undefined;
  }
  rejectUnknownFields(inputs, ['reference', 'target'], '$.inputs', issues);
  const reference = validateReferenceInput(inputs.reference, issues);
  const target = validateTargetInput(inputs.target, issues);
  if (!reference || !target) {
    return undefined;
  }
  return {reference, target};
}

function validateLifton(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): AnnotationTransferConfiguration['lifton'] | undefined {
  const lifton = requireObject(value, '$.lifton', issues);
  if (!lifton) {
    return undefined;
  }
  rejectUnknownFields(lifton, ['profile'], '$.lifton', issues);
  if (lifton.profile !== 'same-species') {
    issues.push({path: '$.lifton.profile', message: "must equal 'same-species'"});
    return undefined;
  }
  return lifton as AnnotationTransferConfiguration['lifton'];
}

export function validateAnnotationTransferConfiguration(
  value: unknown,
): AnnotationTransferConfiguration {
  const issues: ConfigurationValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new AnnotationTransferConfigurationError([{path: '$', message: 'must be an object'}]);
  }

  rejectUnknownFields(
    value,
    [
      'schema_version',
      'workflow_id',
      'workflow_version',
      'inputs',
      'lifton',
      'resources',
      'run',
    ],
    '$',
    issues,
  );
  validateWorkflowIdentity(value, {
    schemaVersion: ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION,
    workflowId: ANNOTATION_TRANSFER_WORKFLOW_ID,
    workflowVersion: ANNOTATION_TRANSFER_WORKFLOW_VERSION,
  }, issues);

  const inputs = validateInputs(value.inputs, issues);
  const lifton = validateLifton(value.lifton, issues);
  const resources = validateResources(value.resources, issues);
  const run = validateRun(value.run, issues);

  if (issues.length > 0) {
    throw new AnnotationTransferConfigurationError(issues);
  }

  return {
    schema_version: ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION,
    workflow_id: ANNOTATION_TRANSFER_WORKFLOW_ID,
    workflow_version: ANNOTATION_TRANSFER_WORKFLOW_VERSION,
    inputs: inputs as AnnotationTransferConfiguration['inputs'],
    lifton: lifton as AnnotationTransferConfiguration['lifton'],
    resources: resources as AnnotationTransferConfiguration['resources'],
    run: run as AnnotationTransferConfiguration['run'],
  };
}

export function parseAnnotationTransferConfiguration(
  source: string,
): AnnotationTransferConfiguration {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AnnotationTransferConfigurationError([
      {path: '$', message: `is not valid YAML: ${detail}`},
    ]);
  }
  return validateAnnotationTransferConfiguration(value);
}
