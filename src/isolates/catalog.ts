import {isAbsolute, resolve} from 'node:path';
import {parse} from 'yaml';

export const ISOLATE_CATALOG_SCHEMA_VERSION = 1 as const;

/** One R1/R2 FASTQ pair, typically one lane of one sequencing run. */
export type ReadPair = {
  r1: string;
  r2: string;
  /** Whether the reads were already trimmed or filtered before reaching Genopilot. */
  trimmed: boolean;
};

export type Isolate = {
  id: string;
  name: string;
  description?: string;
  wildtype: boolean;
  derived_from: string | null;
  read_pairs: ReadPair[];
};

export type IsolateCatalog = {
  schema_version: typeof ISOLATE_CATALOG_SCHEMA_VERSION;
  isolates: Isolate[];
};

export type IsolateCatalogValidationIssue = {
  path: string;
  message: string;
};

export class IsolateCatalogValidationError extends Error {
  readonly issues: readonly IsolateCatalogValidationIssue[];

  constructor(issues: IsolateCatalogValidationIssue[]) {
    super(
      `Invalid isolate catalog:\n${issues
        .map(issue => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'IsolateCatalogValidationError';
    this.issues = issues;
  }
}

export const isolateIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function emptyIsolateCatalog(): IsolateCatalog {
  return {schema_version: ISOLATE_CATALOG_SCHEMA_VERSION, isolates: []};
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  issues: IsolateCatalogValidationIssue[],
): void {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      issues.push({path: `${path}.${field}`, message: 'unknown field'});
    }
  }
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function validateReadPath(
  value: unknown,
  path: string,
  issues: IsolateCatalogValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({path, message: 'must be a non-empty string'});
    return false;
  }
  if (hasControlCharacters(value) || value !== value.trim()) {
    issues.push({path, message: 'must not contain surrounding whitespace or control characters'});
    return false;
  }
  if (!isAbsolute(value)) {
    issues.push({path, message: 'must be an absolute path'});
    return false;
  }
  return true;
}

function validateReadPair(
  value: unknown,
  path: string,
  issues: IsolateCatalogValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  rejectUnknownFields(value, ['r1', 'r2', 'trimmed'], path, issues);
  validateReadPath(value.r1, `${path}.r1`, issues);
  validateReadPath(value.r2, `${path}.r2`, issues);
  if (typeof value.trimmed !== 'boolean') {
    issues.push({path: `${path}.trimmed`, message: 'must be true or false'});
  }
}

function validateIsolate(
  value: unknown,
  path: string,
  issues: IsolateCatalogValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  rejectUnknownFields(value, ['id', 'name', 'description', 'wildtype', 'derived_from', 'read_pairs'], path, issues);
  if (typeof value.id !== 'string' || !isolateIdPattern.test(value.id)) {
    issues.push({
      path: `${path}.id`,
      message: 'must use lowercase letters, numbers, and single hyphens and start with a letter',
    });
  }
  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    issues.push({path: `${path}.name`, message: 'must be a non-empty string'});
  } else if (value.name !== value.name.trim() || hasControlCharacters(value.name)) {
    issues.push({
      path: `${path}.name`,
      message: 'must not contain surrounding whitespace or control characters',
    });
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    issues.push({path: `${path}.description`, message: 'must be a string when present'});
  }
  if (typeof value.wildtype !== 'boolean') {
    issues.push({path: `${path}.wildtype`, message: 'must be true or false'});
  }
  if (value.derived_from !== null && typeof value.derived_from !== 'string') {
    issues.push({path: `${path}.derived_from`, message: 'must be an isolate ID or null'});
  }
  if (!Array.isArray(value.read_pairs) || value.read_pairs.length === 0) {
    issues.push({path: `${path}.read_pairs`, message: 'must be a non-empty list'});
    return;
  }
  value.read_pairs.forEach((pair, index) => validateReadPair(pair, `${path}.read_pairs[${index}]`, issues));
}

/**
 * Checks what only the whole catalog can reveal: a read file used twice, and raw reads mixed with
 * trimmed reads in one isolate, which would process that isolate inconsistently.
 */
function validateReadFileUse(isolates: readonly Isolate[], issues: IsolateCatalogValidationIssue[]): void {
  const firstUse = new Map<string, string>();
  isolates.forEach((isolate, isolateIndex) => {
    const path = `$.isolates[${isolateIndex}].read_pairs`;
    isolate.read_pairs.forEach((pair, pairIndex) => {
      for (const mate of ['r1', 'r2'] as const) {
        const matePath = `${path}[${pairIndex}].${mate}`;
        const file = resolve(pair[mate]);
        const previous = firstUse.get(file);
        if (previous === undefined) {
          firstUse.set(file, matePath);
        } else {
          issues.push({path: matePath, message: `uses the same file as ${previous}`});
        }
      }
    });
    if (new Set(isolate.read_pairs.map(pair => pair.trimmed)).size > 1) {
      issues.push({path, message: 'must not mix trimmed and untrimmed read pairs'});
    }
  });
}

/** Reports duplicate IDs, dangling or self references, and cycles in `derived_from` lineage. */
function validateLineage(isolates: readonly Isolate[], issues: IsolateCatalogValidationIssue[]): void {
  const indexById = new Map<string, number>();
  isolates.forEach((isolate, index) => {
    const previous = indexById.get(isolate.id);
    if (previous === undefined) {
      indexById.set(isolate.id, index);
    } else {
      issues.push({
        path: `$.isolates[${index}].id`,
        message: `duplicates the ID of $.isolates[${previous}]`,
      });
    }
  });

  isolates.forEach((isolate, index) => {
    const parent = isolate.derived_from;
    if (parent === null) {
      return;
    }
    const path = `$.isolates[${index}].derived_from`;
    if (parent === isolate.id) {
      issues.push({path, message: 'must not reference the isolate itself'});
      return;
    }
    if (!indexById.has(parent)) {
      issues.push({path, message: `references unknown isolate "${parent}"`});
      return;
    }
    const visited = new Set([isolate.id]);
    let current: string | null = parent;
    while (current !== null) {
      if (visited.has(current)) {
        issues.push({path, message: 'forms a lineage cycle'});
        return;
      }
      visited.add(current);
      const currentIndex = indexById.get(current);
      current = currentIndex === undefined ? null : isolates[currentIndex]?.derived_from ?? null;
    }
  });
}

export function validateIsolateCatalog(value: unknown): IsolateCatalog {
  const issues: IsolateCatalogValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new IsolateCatalogValidationError([{path: '$', message: 'must be a mapping'}]);
  }
  rejectUnknownFields(value, ['schema_version', 'isolates'], '$', issues);
  if (value.schema_version !== ISOLATE_CATALOG_SCHEMA_VERSION) {
    issues.push({
      path: '$.schema_version',
      message: `must be ${String(ISOLATE_CATALOG_SCHEMA_VERSION)}`,
    });
  }
  if (!Array.isArray(value.isolates)) {
    issues.push({path: '$.isolates', message: 'must be a list'});
  } else {
    value.isolates.forEach((isolate, index) => validateIsolate(isolate, `$.isolates[${index}]`, issues));
  }
  if (issues.length > 0) {
    throw new IsolateCatalogValidationError(issues);
  }
  const catalog = value as IsolateCatalog;
  validateLineage(catalog.isolates, issues);
  validateReadFileUse(catalog.isolates, issues);
  if (issues.length > 0) {
    throw new IsolateCatalogValidationError(issues);
  }
  return catalog;
}

export function parseIsolateCatalog(source: string): IsolateCatalog {
  return validateIsolateCatalog(parse(source));
}

/** Suggests an unused isolate ID derived from a display name. */
export function suggestIsolateId(name: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length === 0) {
    base = 'isolate';
  } else if (!/^[a-z]/.test(base)) {
    base = `isolate-${base}`;
  }
  if (!existing.has(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}

/** IDs of isolates whose `derived_from` names `id`. */
export function childIsolateIds(catalog: IsolateCatalog, id: string): string[] {
  return catalog.isolates.filter(isolate => isolate.derived_from === id).map(isolate => isolate.id);
}
