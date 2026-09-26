import {isAbsolute} from 'node:path';
import {isVersionedAssemblyAccession, ncbiAccessionFormatMessage} from '../accessions/accession.js';

/** Validation helpers and sections shared by every workflow's run configuration. */

export type CpuMode = 'automatic' | 'leave-one-free' | 'manual';
export type NcbiCacheMode = 'reuse' | 'refresh';

export type ConfigurationValidationIssue = {
  path: string;
  message: string;
};

export type ResourceSettings = {
  cpu_mode: CpuMode;
  manual_limit?: number;
  effective_cpus: number;
};

export type RunDetails = {
  output_root: string;
  id: string;
  name?: string;
  created_at: string;
  description?: string;
};

export type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function rejectUnknownFields(
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

export function requireObject(
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

export function requireNonEmptyString(
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

export function validateAbsolutePath(
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

export function validateAccession(
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

export function validateInputSource(
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

export function validateNcbiCacheMode(
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

export function validateTimestamp(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): value is string {
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

export function validateResources(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): ResourceSettings | undefined {
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

  return valid ? (resources as ResourceSettings) : undefined;
}

export function validateRun(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): RunDetails | undefined {
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
  const validCreatedAt = validateTimestamp(run.created_at, '$.run.created_at', issues);
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
  return run as RunDetails;
}

/** Checks the fixed identity fields every configuration starts with. */
export function validateWorkflowIdentity(
  value: RecordValue,
  expected: {schemaVersion: number; workflowId: string; workflowVersion: number},
  issues: ConfigurationValidationIssue[],
): void {
  if (value.schema_version !== expected.schemaVersion) {
    issues.push({
      path: '$.schema_version',
      message: `must equal supported version ${expected.schemaVersion}`,
    });
  }
  if (value.workflow_id !== expected.workflowId) {
    issues.push({
      path: '$.workflow_id',
      message: `must equal '${expected.workflowId}'`,
    });
  }
  if (value.workflow_version !== expected.workflowVersion) {
    issues.push({
      path: '$.workflow_version',
      message: `must equal supported version ${expected.workflowVersion}`,
    });
  }
}
