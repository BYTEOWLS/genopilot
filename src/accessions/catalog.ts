import {basename, isAbsolute, resolve} from 'node:path';
import {parse} from 'yaml';
import {genomeSources} from './registry.js';
import {referenceKey, sameReference, type GenomeReference} from './provider.js';

export const ACCESSION_CATALOG_SCHEMA_VERSION = 2 as const;

/** A cache directory that matched its recorded checksums when discovery last ran. */
export type CachedCopy = {
  path: string;
  verified_at: string;
  fasta_sha256?: string;
  gff3_sha256?: string;
};

export type AccessionEntry = GenomeReference & {
  /** Researcher-chosen label; the provider ID is shown when absent. */
  name?: string;
  description?: string;
  /** Null until metadata was retrieved. */
  metadata: unknown;
  cached_copies: CachedCopy[];
};

export type AccessionCatalog = {
  schema_version: typeof ACCESSION_CATALOG_SCHEMA_VERSION;
  /** Output roots whose registered provider caches discovery scans, besides `<cwd>/runs`. */
  output_roots: string[];
  accessions: AccessionEntry[];
};

export type AccessionCatalogValidationIssue = {
  path: string;
  message: string;
};

export class AccessionCatalogValidationError extends Error {
  readonly issues: readonly AccessionCatalogValidationIssue[];

  constructor(issues: AccessionCatalogValidationIssue[]) {
    super(
      `Invalid accession catalog:\n${issues
        .map(issue => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'AccessionCatalogValidationError';
    this.issues = issues;
  }
}

export function emptyAccessionCatalog(): AccessionCatalog {
  return {schema_version: ACCESSION_CATALOG_SCHEMA_VERSION, output_roots: [], accessions: []};
}

type RecordValue = Record<string, unknown>;
type Issues = AccessionCatalogValidationIssue[];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value: RecordValue, allowed: readonly string[], path: string, issues: Issues): void {
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

function validateText(value: unknown, path: string, issues: Issues, required: boolean): void {
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({path, message: required ? 'must be a non-empty string' : 'must be a non-empty string when present'});
  } else if (value !== value.trim() || hasControlCharacters(value)) {
    issues.push({path, message: 'must not contain surrounding whitespace or control characters'});
  }
}

function validateAbsolutePath(value: unknown, path: string, issues: Issues): value is string {
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

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function validateTimestamp(value: unknown, path: string, issues: Issues): void {
  if (typeof value !== 'string' || !timestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push({path, message: 'must be a UTC timestamp such as 2026-01-01T12:00:00.000Z'});
  }
}

const sha256Pattern = /^[0-9a-f]{64}$/;

function validateSha256(value: unknown, path: string, issues: Issues, required: boolean): void {
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    issues.push({path, message: 'must be a lowercase hexadecimal SHA-256 checksum'});
  }
}

function validateCachedCopy(value: unknown, accession: unknown, path: string, issues: Issues): void {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  rejectUnknownFields(value, ['path', 'verified_at', 'fasta_sha256', 'gff3_sha256'], path, issues);
  if (validateAbsolutePath(value.path, `${path}.path`, issues) && basename(value.path) !== accession) {
    issues.push({path: `${path}.path`, message: 'must be a directory named after the accession'});
  }
  validateTimestamp(value.verified_at, `${path}.verified_at`, issues);
  if (value.fasta_sha256 === undefined && value.gff3_sha256 === undefined) {
    issues.push({path, message: 'must record at least one artifact checksum'});
  }
  validateSha256(value.fasta_sha256, `${path}.fasta_sha256`, issues, false);
  validateSha256(value.gff3_sha256, `${path}.gff3_sha256`, issues, false);
}

function validateEntry(value: unknown, path: string, issues: Issues): void {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  rejectUnknownFields(value, ['source', 'id', 'parameters', 'name', 'description', 'metadata', 'cached_copies'], path, issues);
  try {
    genomeSources.validateReference(value);
  } catch (error) {
    issues.push({path, message: error instanceof Error ? error.message : 'invalid genome reference'});
  }
  validateText(value.name, `${path}.name`, issues, false);
  if (value.description !== undefined && typeof value.description !== 'string') {
    issues.push({path: `${path}.description`, message: 'must be a string when present'});
  }
  if (typeof value.source === 'string' && genomeSources.has(value.source)) {
    try {
      genomeSources.get(value.source).validateMetadata(value.metadata);
    } catch (error) {
      issues.push({path: `${path}.metadata`, message: error instanceof Error ? error.message : 'invalid metadata'});
    }
  }
  if (!Array.isArray(value.cached_copies)) {
    issues.push({path: `${path}.cached_copies`, message: 'must be a list'});
    return;
  }
  value.cached_copies.forEach((copy, index) =>
    validateCachedCopy(copy, value.id, `${path}.cached_copies[${index}]`, issues));
}

/** Checks what only the whole catalog can reveal: repeated accessions, roots, and copy paths. */
function validateUniqueness(catalog: AccessionCatalog, issues: Issues): void {
  const roots = new Set<string>();
  catalog.output_roots.forEach((root, index) => {
    const normalized = resolve(root);
    if (roots.has(normalized)) {
      issues.push({path: `$.output_roots[${index}]`, message: 'is listed more than once'});
    }
    roots.add(normalized);
  });
  const accessions = new Set<string>();
  const copyPaths = new Set<string>();
  catalog.accessions.forEach((entry, index) => {
    if (accessions.has(referenceKey(entry))) {
      issues.push({path: `$.accessions[${index}].id`, message: 'is already cataloged'});
    }
    accessions.add(referenceKey(entry));
    entry.cached_copies.forEach((copy, copyIndex) => {
      const normalized = resolve(copy.path);
      if (copyPaths.has(normalized)) {
        issues.push({
          path: `$.accessions[${index}].cached_copies[${copyIndex}].path`,
          message: 'is recorded more than once',
        });
      }
      copyPaths.add(normalized);
    });
  });
}

export function validateAccessionCatalog(value: unknown): AccessionCatalog {
  const issues: Issues = [];
  if (!isRecord(value)) {
    throw new AccessionCatalogValidationError([{path: '$', message: 'must be a mapping'}]);
  }
  rejectUnknownFields(value, ['schema_version', 'output_roots', 'accessions'], '$', issues);
  if (value.schema_version !== ACCESSION_CATALOG_SCHEMA_VERSION) {
    issues.push({path: '$.schema_version', message: `must be ${String(ACCESSION_CATALOG_SCHEMA_VERSION)}`});
  }
  if (!Array.isArray(value.output_roots)) {
    issues.push({path: '$.output_roots', message: 'must be a list'});
  } else {
    value.output_roots.forEach((root, index) => validateAbsolutePath(root, `$.output_roots[${index}]`, issues));
  }
  if (!Array.isArray(value.accessions)) {
    issues.push({path: '$.accessions', message: 'must be a list'});
  } else {
    value.accessions.forEach((entry, index) => validateEntry(entry, `$.accessions[${index}]`, issues));
  }
  if (issues.length > 0) {
    throw new AccessionCatalogValidationError(issues);
  }
  const catalog = value as AccessionCatalog;
  validateUniqueness(catalog, issues);
  if (issues.length > 0) {
    throw new AccessionCatalogValidationError(issues);
  }
  return catalog;
}

export function parseAccessionCatalog(source: string): AccessionCatalog {
  return validateAccessionCatalog(parse(source));
}

/** Replaces the entry with the same provider/ID pair, or appends a new one. */
export function withAccession(catalog: AccessionCatalog, entry: AccessionEntry): AccessionCatalog {
  const exists = catalog.accessions.some(candidate => sameReference(candidate, entry));
  return {
    ...catalog,
    accessions: exists
      ? catalog.accessions.map(candidate => sameReference(candidate, entry) ? entry : candidate)
      : [...catalog.accessions, entry],
  };
}

export function accessionDisplayName(entry: AccessionEntry): string {
  return entry.name ?? entry.id;
}

/** Provider-owned facts that tell genomes apart at a glance. */
export function accessionFactsSummary(entry: AccessionEntry): string {
  return genomeSources.get(entry.source).metadataSummary(entry.metadata);
}

/**
 * `conflict` means verified copies disagree about the bytes of one versioned accession. That needs
 * inspection; no copy is preferred automatically.
 */
export type RecordedCacheState = 'not-cached' | 'cached' | 'conflict';

/** Why an accession whose cached copies conflict cannot be used, for a validation problem. */
export const conflictingCopiesMessage =
  'has cached copies whose checksums disagree in the accession catalog; remove the entry under ' +
  'Manage genome sources, which deletes its cached copies, before using it';

export function recordedCacheState(entry: AccessionEntry): RecordedCacheState {
  if (entry.cached_copies.length === 0) {
    return 'not-cached';
  }
  const fastaChecksums = new Set(entry.cached_copies.flatMap(copy => copy.fasta_sha256 ?? []));
  // Different artifact subsets do not conflict; compare only checksums actually recorded.
  const gff3Checksums = new Set(entry.cached_copies.flatMap(copy => copy.gff3_sha256 ?? []));
  return fastaChecksums.size > 1 || gff3Checksums.size > 1 ? 'conflict' : 'cached';
}
