import {isAbsolute} from 'node:path';
import {parse} from 'yaml';
import {isVersionedAssemblyAccession, ncbiAccessionFormatMessage} from '../../accessions/accession.js';

export const ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const ANNOTATION_TRANSFER_WORKFLOW_ID = 'annotation-transfer' as const;
export const ANNOTATION_TRANSFER_WORKFLOW_VERSION = 1 as const;

export type CpuMode = 'automatic' | 'leave-one-free' | 'manual';
export type NcbiCacheMode = 'reuse' | 'refresh';

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
  annotation: {
    id_prefix: string;
  };
  lifton: {
    profile: 'same-species';
  };
  resources: {
    cpu_mode: CpuMode;
    manual_limit?: number;
    effective_cpus: number;
  };
  run: {
    output_root: string;
    id: string;
    name?: string;
    created_at: string;
    description?: string;
  };
};

export type ConfigurationValidationIssue = {
  path: string;
  message: string;
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

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  issues: ConfigurationValidationIssue[],
): void {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      issues.push({path: `${path}.${field}`, message: 'unknown field'});
    }
  }
}

function requireObject(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): RecordValue | undefined {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be an object'});
    return undefined;
  }
  return value;
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({path, message: 'must be a non-empty string'});
    return false;
  }
  return true;
}

function validateAbsolutePath(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): value is string {
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }
  if (value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    issues.push({path, message: 'must not contain surrounding whitespace or control characters'});
    return false;
  }
  if (!isAbsolute(value)) {
    issues.push({path, message: 'must be an absolute path'});
    return false;
  }
  return true;
}

function validateAccession(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): value is string {
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }
  if (!isVersionedAssemblyAccession(value)) {
    issues.push({path, message: ncbiAccessionFormatMessage});
    return false;
  }
  return true;
}

// The run ID is the run's directory name, so it must stay a safe single path segment. The
// pattern is deliberately wider than the timestamped IDs this application generates, so a run
// created directly through Snakemake still loads.
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const maximumRunIdLength = 128;

function validateRunId(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): value is string {
  const path = '$.run.id';
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }
  if (!runIdPattern.test(value) || value.length > maximumRunIdLength) {
    issues.push({
      path,
      message:
        'must start with a letter or digit and contain only letters, digits, dots, underscores,' +
        ` or hyphens, up to ${String(maximumRunIdLength)} characters`,
    });
    return false;
  }
  return true;
}

/** The optional researcher-facing label, stored exactly as typed; never a path segment. */
function validateRunName(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): value is string {
  const path = '$.run.name';
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }
  if (value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    issues.push({
      path,
      message: 'must be trimmed and contain no control characters',
    });
    return false;
  }
  return true;
}

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validateCreatedAt(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): value is string {
  const path = '$.run.created_at';
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }
  if (!isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push({
      path,
      message: 'must be an ISO 8601 UTC timestamp with millisecond precision (for example 2026-09-05T08:34:12.123Z)',
    });
    return false;
  }
  return true;
}

function validateInputSource(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): 'local' | 'ncbi' | undefined {
  if (value !== 'local' && value !== 'ncbi') {
    issues.push({path: `${path}.source`, message: "must be 'local' or 'ncbi'"});
    return undefined;
  }
  return value;
}

function validateNcbiCacheMode(
  value: RecordValue,
  path: string,
  issues: ConfigurationValidationIssue[],
): boolean {
  if (
    'ncbi_cache_mode' in value &&
    value.ncbi_cache_mode !== 'reuse' &&
    value.ncbi_cache_mode !== 'refresh'
  ) {
    issues.push({path: `${path}.ncbi_cache_mode`, message: "must be 'reuse' or 'refresh'"});
    return false;
  }
  return true;
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

function validateAnnotation(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): AnnotationTransferConfiguration['annotation'] | undefined {
  const annotation = requireObject(value, '$.annotation', issues);
  if (!annotation) {
    return undefined;
  }
  rejectUnknownFields(annotation, ['id_prefix'], '$.annotation', issues);
  if (typeof annotation.id_prefix !== 'string') {
    issues.push({path: '$.annotation.id_prefix', message: 'must be a string'});
    return undefined;
  }
  if (
    annotation.id_prefix.length > 0 &&
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(annotation.id_prefix)
  ) {
    issues.push({
      path: '$.annotation.id_prefix',
      message: 'must start with a letter and contain only letters, numbers, underscores, or hyphens',
    });
    return undefined;
  }
  return annotation as AnnotationTransferConfiguration['annotation'];
}

function validateResources(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): AnnotationTransferConfiguration['resources'] | undefined {
  const resources = requireObject(value, '$.resources', issues);
  if (!resources) {
    return undefined;
  }
  rejectUnknownFields(
    resources,
    ['cpu_mode', 'manual_limit', 'effective_cpus'],
    '$.resources',
    issues,
  );

  const validModes: CpuMode[] = ['automatic', 'leave-one-free', 'manual'];
  const mode = resources.cpu_mode;
  if (typeof mode !== 'string' || !validModes.includes(mode as CpuMode)) {
    issues.push({
      path: '$.resources.cpu_mode',
      message: `must be one of: ${validModes.join(', ')}`,
    });
    return undefined;
  }

  let valid = true;
  if (mode === 'manual') {
    if (!Number.isSafeInteger(resources.manual_limit) || (resources.manual_limit as number) < 1) {
      issues.push({
        path: '$.resources.manual_limit',
        message: 'must be a positive integer when cpu_mode is manual',
      });
      valid = false;
    }
  } else if ('manual_limit' in resources) {
    issues.push({
      path: '$.resources.manual_limit',
      message: 'must be omitted unless cpu_mode is manual',
    });
    valid = false;
  }
  if (!Number.isSafeInteger(resources.effective_cpus) || (resources.effective_cpus as number) < 1) {
    issues.push({
      path: '$.resources.effective_cpus',
      message: 'must be a positive integer',
    });
    valid = false;
  }

  return valid ? (resources as AnnotationTransferConfiguration['resources']) : undefined;
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

function validateRun(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): AnnotationTransferConfiguration['run'] | undefined {
  const run = requireObject(value, '$.run', issues);
  if (!run) {
    return undefined;
  }
  rejectUnknownFields(
    run,
    ['output_root', 'id', 'name', 'created_at', 'description'],
    '$.run',
    issues,
  );
  const validOutputRoot = validateAbsolutePath(run.output_root, '$.run.output_root', issues);
  const validId = validateRunId(run.id, issues);
  const validCreatedAt = validateCreatedAt(run.created_at, issues);
  let validName = true;
  if ('name' in run) {
    validName = validateRunName(run.name, issues);
  }
  let validDescription = true;
  if ('description' in run) {
    validDescription = requireNonEmptyString(run.description, '$.run.description', issues);
  }
  if (!validOutputRoot || !validId || !validName || !validCreatedAt || !validDescription) {
    return undefined;
  }
  return run as AnnotationTransferConfiguration['run'];
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
      'annotation',
      'lifton',
      'resources',
      'run',
    ],
    '$',
    issues,
  );
  if (value.schema_version !== ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION) {
    issues.push({
      path: '$.schema_version',
      message: `must equal supported version ${ANNOTATION_TRANSFER_CONFIGURATION_SCHEMA_VERSION}`,
    });
  }
  if (value.workflow_id !== ANNOTATION_TRANSFER_WORKFLOW_ID) {
    issues.push({
      path: '$.workflow_id',
      message: `must equal '${ANNOTATION_TRANSFER_WORKFLOW_ID}'`,
    });
  }
  if (value.workflow_version !== ANNOTATION_TRANSFER_WORKFLOW_VERSION) {
    issues.push({
      path: '$.workflow_version',
      message: `must equal supported version ${ANNOTATION_TRANSFER_WORKFLOW_VERSION}`,
    });
  }

  const inputs = validateInputs(value.inputs, issues);
  const annotation = validateAnnotation(value.annotation, issues);
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
    annotation: annotation as AnnotationTransferConfiguration['annotation'],
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
