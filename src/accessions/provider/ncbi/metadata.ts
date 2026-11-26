/** Where fetched NCBI facts came from: the live Datasets API or a cached download's own report. */
export type NcbiMetadataSource = 'datasets-v2-rest' | 'cached-download-report';

/**
 * Lightweight facts NCBI reports for an assembly. Optional fields are omitted when NCBI does not
 * provide them; they are never guessed or filled in by the researcher.
 */
export type NcbiAssemblyMetadata = {
  organism: string;
  tax_id?: number;
  assembly_name?: string;
  assembly_level?: string;
  assembly_status?: string;
  /** Whether the assembly is haploid, diploid, and so on. */
  assembly_type?: string;
  /** RefSeq's designation, such as `reference genome`; most assemblies have none. */
  refseq_category?: string;
  strain?: string;
  /** Who submitted the assembly to NCBI. */
  submitter?: string;
  /** Assembly release date, not the submission or metadata retrieval date. */
  release_date?: string;
  total_sequence_length?: number;
  gc_percent?: number;
  number_of_contigs?: number;
  number_of_scaffolds?: number;
  contig_n50?: number;
  scaffold_n50?: number;
  bioproject_accession?: string;
  biosample_accession?: string;
  retrieved_at: string;
  source: NcbiMetadataSource;
};

type RecordValue = Record<string, unknown>;
type Issues = {path: string; message: string}[];

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

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function validateTimestamp(value: unknown, path: string, issues: Issues): void {
  if (typeof value !== 'string' || !timestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push({path, message: 'must be a UTC timestamp such as 2026-01-01T12:00:00.000Z'});
  }
}

export function validateNcbiMetadata(value: unknown, path: string, issues: Issues): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    issues.push({path, message: 'must be a mapping or null'});
    return;
  }
  rejectUnknownFields(
    value,
    [
      'organism',
      'tax_id',
      'assembly_name',
      'assembly_level',
      'assembly_status',
      'assembly_type',
      'refseq_category',
      'strain',
      'submitter',
      'release_date',
      'total_sequence_length',
      'gc_percent',
      'number_of_contigs',
      'number_of_scaffolds',
      'contig_n50',
      'scaffold_n50',
      'bioproject_accession',
      'biosample_accession',
      'retrieved_at',
      'source',
    ],
    path,
    issues,
  );
  validateText(value.organism, `${path}.organism`, issues, true);
  if (value.tax_id !== undefined && !(Number.isSafeInteger(value.tax_id) && (value.tax_id as number) > 0)) {
    issues.push({path: `${path}.tax_id`, message: 'must be a positive integer when present'});
  }
  for (const field of [
    'assembly_name',
    'assembly_level',
    'assembly_status',
    'assembly_type',
    'refseq_category',
    'strain',
    'submitter',
    'release_date',
    'bioproject_accession',
    'biosample_accession',
  ] as const) {
    validateText(value[field], `${path}.${field}`, issues, false);
  }
  for (const field of ['total_sequence_length', 'number_of_contigs', 'number_of_scaffolds', 'contig_n50', 'scaffold_n50'] as const) {
    if (value[field] !== undefined && !(Number.isSafeInteger(value[field]) && (value[field] as number) >= 0)) {
      issues.push({path: `${path}.${field}`, message: 'must be a non-negative safe integer when present'});
    }
  }
  if (value.gc_percent !== undefined && !(typeof value.gc_percent === 'number' && Number.isFinite(value.gc_percent) && value.gc_percent >= 0 && value.gc_percent <= 100)) {
    issues.push({path: `${path}.gc_percent`, message: 'must be a percentage between 0 and 100 when present'});
  }
  validateTimestamp(value.retrieved_at, `${path}.retrieved_at`, issues);
  if (value.source !== 'datasets-v2-rest' && value.source !== 'cached-download-report') {
    issues.push({path: `${path}.source`, message: 'must be datasets-v2-rest or cached-download-report'});
  }
}

