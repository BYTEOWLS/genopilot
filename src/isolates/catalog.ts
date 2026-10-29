import {isAbsolute, resolve} from 'node:path';
import {parse} from 'yaml';
import {validateIlluminaMetadata} from './illumina/metadata.js';

export const ISOLATE_CATALOG_SCHEMA_VERSION = 1 as const;

/** One R1/R2 FASTQ pair, typically one lane of one sequencing run. */
export type ReadPair = {
  r1: string;
  r2: string;
  /** Previous trimming/filtering: true, false, or null when unknown. */
  trimmed: boolean | null;
};

export type ReadSet = {
  id: string;
  name: string;
  platform: 'illumina';
  layout: 'paired-end';
  /** Confirmed by the researcher; shared across resequencing of the same library. */
  library_id: string;
  illumina: {
    chemistry: 'four-colour' | 'two-colour' | 'one-channel' | 'unknown';
    poly_g: 'auto' | 'on' | 'off';
  };
  read_pairs: ReadPair[];
};

export function readPairs(isolate: Pick<Isolate, 'read_sets'>): ReadPair[] {
  return isolate.read_sets.flatMap(readSet => readSet.read_pairs);
}

export type Isolate = {
  id: string;
  name: string;
  description?: string;
  /** Researcher-supplied lineage metadata; null when not recorded. */
  wildtype: boolean | null;
  derived_from: string | null;
  read_sets: ReadSet[];
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
  if (value.trimmed !== null && typeof value.trimmed !== 'boolean') {
    issues.push({path: `${path}.trimmed`, message: 'must be true, false, or null (unknown)'});
  }
}

export const libraryIdPattern = /^[A-Za-z0-9._+-]+$/;

function validateReadSet(value: unknown, path: string, issues: IsolateCatalogValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  rejectUnknownFields(value, ['id', 'name', 'platform', 'layout', 'library_id', 'illumina', 'read_pairs'], path, issues);
  if (typeof value.id !== 'string' || !isolateIdPattern.test(value.id)) {
    issues.push({path: `${path}.id`, message: 'must be a stable lowercase ID using letters, numbers and hyphens'});
  }
  if (typeof value.name !== 'string' || !value.name.trim() || hasControlCharacters(value.name)) {
    issues.push({path: `${path}.name`, message: 'must be a non-empty display name without control characters'});
  }
  if (value.platform !== 'illumina') {
    issues.push({path: `${path}.platform`, message: 'only illumina is currently supported'});
  }
  if (value.layout !== 'paired-end') {
    issues.push({path: `${path}.layout`, message: 'only paired-end is currently supported'});
  }
  if (typeof value.library_id !== 'string' || !libraryIdPattern.test(value.library_id)) {
    issues.push({path: `${path}.library_id`, message: 'confirm a library ID using letters, numbers, dot, underscore, plus or hyphen'});
  }
  validateIlluminaMetadata(value.illumina, `${path}.illumina`, issues);
  if (!Array.isArray(value.read_pairs) || value.read_pairs.length === 0) {
    issues.push({path: `${path}.read_pairs`, message: 'must be a non-empty list'});
  } else {
    value.read_pairs.forEach((pair, index) => validateReadPair(pair, `${path}.read_pairs[${index}]`, issues));
  }
}

/** Validates one isolate record on its own, as the catalog and a run's isolate snapshot store it. */
export function validateIsolate(
  value: unknown,
  path: string,
  issues: IsolateCatalogValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  rejectUnknownFields(value, ['id', 'name', 'description', 'wildtype', 'derived_from', 'read_sets'], path, issues);
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
  if (value.wildtype !== null && typeof value.wildtype !== 'boolean') {
    issues.push({path: `${path}.wildtype`, message: 'must be true, false, or null'});
  }
  if (value.derived_from !== null && typeof value.derived_from !== 'string') {
    issues.push({path: `${path}.derived_from`, message: 'must be an isolate ID or null'});
  }
  if (!Array.isArray(value.read_sets) || value.read_sets.length === 0) {
    issues.push({path: `${path}.read_sets`, message: 'must be a non-empty list; old catalog entries must be discarded and re-imported'});
    return;
  }
  const ids = new Set<unknown>();
  value.read_sets.forEach((readSet, index) => {
    const setPath = `${path}.read_sets[${index}]`;
    validateReadSet(readSet, setPath, issues);
    if (isRecord(readSet)) {
      if (ids.has(readSet.id)) {
        issues.push({path: `${setPath}.id`, message: 'is already used by another read set of this isolate'});
      }
      ids.add(readSet.id);
    }
  });
}

/** Checks what only the whole catalog can reveal: a read file used twice. */
function validateReadFileUse(isolates: readonly Isolate[], issues: IsolateCatalogValidationIssue[]): void {
  const firstUse = new Map<string, {isolateId: string; mate: string}>();
  isolates.forEach((isolate, isolateIndex) => {
    isolate.read_sets.forEach((readSet, setIndex) => {
      const path = `$.isolates[${isolateIndex}].read_sets[${setIndex}].read_pairs`;
      readSet.read_pairs.forEach((pair, pairIndex) => {
        for (const mate of ['r1', 'r2'] as const) {
          const matePath = `${path}[${pairIndex}].${mate}`;
          const file = resolve(pair[mate]);
          const previous = firstUse.get(file);
          if (previous === undefined) {
            firstUse.set(file, {isolateId: isolate.id, mate: `read set ${readSet.id}, pair ${pairIndex + 1} ${mate.toUpperCase()}`});
          } else {
            const owner = previous.isolateId === isolate.id ? '' : `isolate "${previous.isolateId}", `;
            issues.push({path: matePath, message: `uses the same file as ${owner}${previous.mate}`});
          }
        }
      });
    });
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
      issues.push({path: `$.isolates[${index}].id`, message: 'is already used by another isolate'});
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
      message: `unsupported catalog; discard it and re-import using schema ${String(ISOLATE_CATALOG_SCHEMA_VERSION)} (no migration)`,
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

/** Suggest a new preparation, never silently reuse an existing library's identity. */
export function suggestLibraryId(isolateName: string, existingIds: Iterable<string>): string {
  const base = suggestIsolateId(isolateName, []);
  const existing = new Set(existingIds);
  for (let index = 1; ; index++) {
    const candidate = `${base}-library-${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}

/** IDs of isolates whose `derived_from` names `id`. */
export function childIsolateIds(catalog: IsolateCatalog, id: string): string[] {
  return catalog.isolates.filter(isolate => isolate.derived_from === id).map(isolate => isolate.id);
}
