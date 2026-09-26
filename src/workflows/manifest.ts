import {posix} from 'node:path';
import {parse} from 'yaml';

export const WORKFLOW_MANIFEST_SCHEMA_VERSION = 1 as const;

export type WorkflowStage = {
  id: string;
  label: string;
  description?: string;
  /**
   * Snakemake rule names this stage groups, used to present run progress. Rules the manifest
   * does not classify are still reported, grouped separately, so no executed job is hidden.
   * A stage without rules is one whose implementation does not exist yet.
   */
  rules?: string[];
  /**
   * Which of the stage's rules run once for every read pair and which once for every isolate,
   * so progress can be shown per isolate: an isolate with n read pairs runs every read-pair
   * rule n times and every isolate rule once. The stage's other rules are not per isolate.
   */
  per_isolate?: {read_pair_rules: string[]; isolate_rules: string[]};
};

export type WorkflowArtifact = {
  id: string;
  label: string;
  description?: string;
  path: string;
  type: string;
  produced_by: string;
};

export type WorkflowManifest = {
  schema_version: typeof WORKFLOW_MANIFEST_SCHEMA_VERSION;
  workflow_version: number;
  id: string;
  label: string;
  description: string;
  entry_snakefile: string;
  'parameter-definitions': string;
  stages: WorkflowStage[];
  artifacts: WorkflowArtifact[];
};

export type WorkflowManifestValidationIssue = {
  path: string;
  message: string;
};

export class WorkflowManifestValidationError extends Error {
  readonly issues: readonly WorkflowManifestValidationIssue[];

  constructor(issues: WorkflowManifestValidationIssue[]) {
    super(
      `Invalid workflow manifest:\n${issues
        .map(issue => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'WorkflowManifestValidationError';
    this.issues = issues;
  }
}

const identifierPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  issues: WorkflowManifestValidationIssue[],
): void {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      issues.push({path: `${path}.${field}`, message: 'unknown field'});
    }
  }
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  issues: WorkflowManifestValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({path, message: 'must be a non-empty string'});
    return false;
  }
  return true;
}

function validateIdentifier(
  value: unknown,
  path: string,
  issues: WorkflowManifestValidationIssue[],
): value is string {
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }
  if (!identifierPattern.test(value)) {
    issues.push({
      path,
      message: 'must use lowercase letters, numbers, and single hyphens and start with a letter',
    });
    return false;
  }
  return true;
}

function validateContainedRelativePath(
  value: unknown,
  path: string,
  issues: WorkflowManifestValidationIssue[],
): value is string {
  if (!requireNonEmptyString(value, path, issues)) {
    return false;
  }

  if (value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    issues.push({path, message: 'must not contain surrounding whitespace or control characters'});
    return false;
  }

  const hasWindowsDrive = /^[A-Za-z]:[\\/]/.test(value);
  const segments = value.split('/');
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    hasWindowsDrive ||
    segments.includes('..')
  ) {
    issues.push({path, message: 'must be a contained relative path using forward slashes'});
    return false;
  }
  if (value === '.' || posix.normalize(value) !== value) {
    issues.push({path, message: 'must be normalized'});
    return false;
  }
  return true;
}

function validateOptionalDescription(
  value: RecordValue,
  path: string,
  issues: WorkflowManifestValidationIssue[],
): void {
  if ('description' in value) {
    requireNonEmptyString(value.description, `${path}.description`, issues);
  }
}

/**
 * Validates a stage's optional Snakemake rule names. A rule belongs to at most one stage, so
 * every executed job maps to exactly one place in the progress view.
 */
function validateStageRules(
  candidate: RecordValue,
  path: string,
  ruleOwners: Map<string, string>,
  issues: WorkflowManifestValidationIssue[],
): boolean {
  if (candidate.rules === undefined) {
    return true;
  }
  if (!Array.isArray(candidate.rules)) {
    issues.push({path: `${path}.rules`, message: 'must be an array'});
    return false;
  }
  if (candidate.rules.length === 0) {
    issues.push({path: `${path}.rules`, message: 'must contain at least one rule when present'});
    return false;
  }
  let valid = true;
  candidate.rules.forEach((rule, index) => {
    const rulePath = `${path}.rules[${index}]`;
    if (typeof rule !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rule)) {
      issues.push({path: rulePath, message: 'must be a Snakemake rule name'});
      valid = false;
      return;
    }
    const owner = ruleOwners.get(rule);
    if (owner !== undefined) {
      issues.push({path: rulePath, message: `rule '${rule}' is already declared by stage '${owner}'`});
      valid = false;
      return;
    }
    ruleOwners.set(rule, typeof candidate.id === 'string' ? candidate.id : path);
  });
  return valid;
}

/** Validates a stage's optional per-isolate rule split against the stage's own rules. */
function validatePerIsolate(
  candidate: RecordValue,
  path: string,
  issues: WorkflowManifestValidationIssue[],
): boolean {
  if (candidate.per_isolate === undefined) {
    return true;
  }
  const perIsolatePath = `${path}.per_isolate`;
  if (!isRecord(candidate.per_isolate)) {
    issues.push({path: perIsolatePath, message: 'must be an object'});
    return false;
  }
  rejectUnknownFields(candidate.per_isolate, ['read_pair_rules', 'isolate_rules'], perIsolatePath, issues);
  const stageRules = new Set(Array.isArray(candidate.rules) ? candidate.rules : []);
  const seen = new Set<unknown>();
  let valid = true;
  for (const field of ['read_pair_rules', 'isolate_rules'] as const) {
    const rules = candidate.per_isolate[field];
    const fieldPath = `${perIsolatePath}.${field}`;
    if (!Array.isArray(rules) || rules.length === 0) {
      issues.push({path: fieldPath, message: 'must be a non-empty array'});
      valid = false;
      continue;
    }
    rules.forEach((rule, index) => {
      if (!stageRules.has(rule)) {
        issues.push({path: `${fieldPath}[${index}]`, message: 'must be one of the stage\'s rules'});
        valid = false;
      } else if (seen.has(rule)) {
        issues.push({path: `${fieldPath}[${index}]`, message: `rule '${String(rule)}' is listed twice`});
        valid = false;
      }
      seen.add(rule);
    });
  }
  return valid;
}

function validateStages(
  value: unknown,
  issues: WorkflowManifestValidationIssue[],
): {stages: WorkflowStage[]; ids: Set<string>} {
  if (!Array.isArray(value)) {
    issues.push({path: '$.stages', message: 'must be an array'});
    return {stages: [], ids: new Set()};
  }
  if (value.length === 0) {
    issues.push({path: '$.stages', message: 'must contain at least one stage'});
  }

  const stages: WorkflowStage[] = [];
  const ids = new Set<string>();
  const ruleOwners = new Map<string, string>();
  value.forEach((candidate, index) => {
    const path = `$.stages[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({path, message: 'must be an object'});
      return;
    }
    rejectUnknownFields(candidate, ['id', 'label', 'description', 'rules', 'per_isolate'], path, issues);
    const validId = validateIdentifier(candidate.id, `${path}.id`, issues);
    const validLabel = requireNonEmptyString(candidate.label, `${path}.label`, issues);
    validateOptionalDescription(candidate, path, issues);
    const validRules =
      validateStageRules(candidate, path, ruleOwners, issues) && validatePerIsolate(candidate, path, issues);
    if (validId) {
      if (ids.has(candidate.id as string)) {
        issues.push({path: `${path}.id`, message: `duplicate stage ID '${candidate.id}'`});
      } else {
        ids.add(candidate.id as string);
      }
    }
    if (validId && validLabel && validRules) {
      stages.push(candidate as WorkflowStage);
    }
  });
  return {stages, ids};
}

function validateArtifacts(
  value: unknown,
  stageIds: Set<string>,
  issues: WorkflowManifestValidationIssue[],
): WorkflowArtifact[] {
  if (!Array.isArray(value)) {
    issues.push({path: '$.artifacts', message: 'must be an array'});
    return [];
  }

  const artifacts: WorkflowArtifact[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `$.artifacts[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({path, message: 'must be an object'});
      return;
    }
    rejectUnknownFields(
      candidate,
      ['id', 'label', 'description', 'path', 'type', 'produced_by'],
      path,
      issues,
    );
    const validId = validateIdentifier(candidate.id, `${path}.id`, issues);
    const validLabel = requireNonEmptyString(candidate.label, `${path}.label`, issues);
    validateOptionalDescription(candidate, path, issues);
    const validPath = validateContainedRelativePath(candidate.path, `${path}.path`, issues);
    const validType = validateIdentifier(candidate.type, `${path}.type`, issues);
    const validProducer = validateIdentifier(candidate.produced_by, `${path}.produced_by`, issues);

    if (validId) {
      if (ids.has(candidate.id as string)) {
        issues.push({path: `${path}.id`, message: `duplicate artifact ID '${candidate.id}'`});
      } else {
        ids.add(candidate.id as string);
      }
    }
    if (validPath) {
      if (paths.has(candidate.path as string)) {
        issues.push({path: `${path}.path`, message: `duplicate artifact path '${candidate.path}'`});
      } else {
        paths.add(candidate.path as string);
      }
    }
    if (validProducer && !stageIds.has(candidate.produced_by as string)) {
      issues.push({
        path: `${path}.produced_by`,
        message: `references unknown stage '${candidate.produced_by}'`,
      });
    }
    if (validId && validLabel && validPath && validType && validProducer) {
      artifacts.push(candidate as WorkflowArtifact);
    }
  });
  return artifacts;
}

export function validateWorkflowManifest(value: unknown): WorkflowManifest {
  const issues: WorkflowManifestValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new WorkflowManifestValidationError([
      {path: '$', message: 'must be an object'},
    ]);
  }

  rejectUnknownFields(
    value,
    [
      'schema_version',
      'workflow_version',
      'id',
      'label',
      'description',
      'entry_snakefile',
      'parameter-definitions',
      'stages',
      'artifacts',
    ],
    '$',
    issues,
  );

  if (value.schema_version !== WORKFLOW_MANIFEST_SCHEMA_VERSION) {
    issues.push({
      path: '$.schema_version',
      message: `must equal supported version ${WORKFLOW_MANIFEST_SCHEMA_VERSION}`,
    });
  }
  if (!Number.isSafeInteger(value.workflow_version) || (value.workflow_version as number) < 1) {
    issues.push({path: '$.workflow_version', message: 'must be a positive integer'});
  }
  validateIdentifier(value.id, '$.id', issues);
  requireNonEmptyString(value.label, '$.label', issues);
  requireNonEmptyString(value.description, '$.description', issues);
  validateContainedRelativePath(value.entry_snakefile, '$.entry_snakefile', issues);
  validateContainedRelativePath(
    value['parameter-definitions'],
    '$.parameter-definitions',
    issues,
  );

  const {stages, ids: stageIds} = validateStages(value.stages, issues);
  const artifacts = validateArtifacts(value.artifacts, stageIds, issues);

  if (issues.length > 0) {
    throw new WorkflowManifestValidationError(issues);
  }

  return {
    schema_version: WORKFLOW_MANIFEST_SCHEMA_VERSION,
    workflow_version: value.workflow_version as number,
    id: value.id as string,
    label: value.label as string,
    description: value.description as string,
    entry_snakefile: value.entry_snakefile as string,
    'parameter-definitions': value['parameter-definitions'] as string,
    stages,
    artifacts,
  };
}

export function parseWorkflowManifest(source: string): WorkflowManifest {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WorkflowManifestValidationError([
      {path: '$', message: `is not valid YAML: ${detail}`},
    ]);
  }
  return validateWorkflowManifest(value);
}
