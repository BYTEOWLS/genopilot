import {parse} from 'yaml';
import {validateRemoteGenomeInput, type RemoteGenomeInput} from '../genome-input.js';
import {
  isRecord,
  rejectUnknownFields,
  requireObject,
  validateAbsolutePath,
  validateGenoPilot,
  validateResources,
  validateRun,
  validateWorkflowIdentity,
  type ConfigurationValidationIssue,
  type CpuMode,
  type GenoPilotDetails,
  type ResourceSettings,
  type RunDetails,
} from '../configuration-validation.js';

export type {ConfigurationValidationIssue, CpuMode};

export const ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION = 2 as const;
export const ANNOTATION_TRANSFER_WORKFLOW_ID = 'annotation-transfer' as const;
export const ANNOTATION_TRANSFER_WORKFLOW_VERSION = 1 as const;

export type ReferenceInput =
  | {source: 'local'; fasta: string; gff3: string}
  | RemoteGenomeInput;

export type TargetInput = {source: 'local'; fasta: string} | RemoteGenomeInput;

export type AnnotationTransferConfiguration = {
  schema_version: typeof ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION;
  workflow_id: typeof ANNOTATION_TRANSFER_WORKFLOW_ID;
  workflow_version: typeof ANNOTATION_TRANSFER_WORKFLOW_VERSION;
  genopilot: GenoPilotDetails;
  inputs: {
    reference: ReferenceInput;
    target: TargetInput;
  };
  lifton: {
    profile: 'same-species';
  };
  /** How the summary step rates transferred proteins for review. */
  review: {
    /** Protein identity in percent below which a coding gene is listed for review. */
    minimum_protein_identity: number;
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
  const source = reference.source;
  if (source === 'local') {
    rejectUnknownFields(reference, ['source', 'fasta', 'gff3'], path, issues);
    const validFasta = validateAbsolutePath(reference.fasta, `${path}.fasta`, issues);
    const validGff3 = validateAbsolutePath(reference.gff3, `${path}.gff3`, issues);
    return validFasta && validGff3 ? (reference as ReferenceInput) : undefined;
  }
  if (source === 'remote') {
    return validateRemoteGenomeInput(reference, path, ['fasta', 'gff3'], issues);
  }
  issues.push({path: `${path}.source`, message: "must be 'local' or 'remote'"});
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
  const source = target.source;
  if (source === 'local') {
    rejectUnknownFields(target, ['source', 'fasta'], path, issues);
    return validateAbsolutePath(target.fasta, `${path}.fasta`, issues)
      ? (target as TargetInput)
      : undefined;
  }
  if (source === 'remote') {
    return validateRemoteGenomeInput(target, path, ['fasta'], issues);
  }
  issues.push({path: `${path}.source`, message: "must be 'local' or 'remote'"});
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

function validateReview(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): AnnotationTransferConfiguration['review'] | undefined {
  const review = requireObject(value, '$.review', issues);
  if (!review) {
    return undefined;
  }
  rejectUnknownFields(review, ['minimum_protein_identity'], '$.review', issues);
  const threshold = review.minimum_protein_identity;
  if (!Number.isSafeInteger(threshold) || (threshold as number) < 0 || (threshold as number) > 100) {
    issues.push({path: '$.review.minimum_protein_identity', message: 'must be an integer from 0 to 100'});
    return undefined;
  }
  return {minimum_protein_identity: threshold as number};
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
      'genopilot',
      'inputs',
      'lifton',
      'review',
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

  const genopilot = validateGenoPilot(value.genopilot, issues);
  const inputs = validateInputs(value.inputs, issues);
  const lifton = validateLifton(value.lifton, issues);
  const review = validateReview(value.review, issues);
  const resources = validateResources(value.resources, issues);
  const run = validateRun(value.run, issues);

  if (issues.length > 0) {
    throw new AnnotationTransferConfigurationError(issues);
  }

  return {
    schema_version: ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION,
    workflow_id: ANNOTATION_TRANSFER_WORKFLOW_ID,
    workflow_version: ANNOTATION_TRANSFER_WORKFLOW_VERSION,
    genopilot: genopilot as AnnotationTransferConfiguration['genopilot'],
    inputs: inputs as AnnotationTransferConfiguration['inputs'],
    lifton: lifton as AnnotationTransferConfiguration['lifton'],
    review: review as AnnotationTransferConfiguration['review'],
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
