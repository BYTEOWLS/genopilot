import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';

/**
 * Reader of the genes listed for review for the Proteins tab of an annotation-transfer result.
 *
 * The summary step rates every coding gene's primary copy in `results/feature-transfer.tsv` and
 * names its review reasons there; this reader keeps the rows with at least one reason. Every
 * value comes from the table; only the order and the filter are presentation.
 */

export const proteinCategories = ['unmapped', 'lost', 'disrupted', 'inframe_indel', 'substitutions', 'unchanged'] as const;
export type ProteinCategory = typeof proteinCategories[number];
export const reviewReasons = ['unmapped_or_lost', 'disrupted', 'below_threshold', 'unresolved_bases'] as const;
export type ReviewReason = typeof reviewReasons[number];
export type ProteinFilter = 'all' | ReviewReason;
export const proteinFilters: readonly ProteinFilter[] = ['all', ...reviewReasons];

export type ReviewGene = {
  referenceId: string;
  featureType: string;
  /** The gene in the reference genome's coordinates, 1-based and inclusive. */
  reference: {seqid: string; start: number; end: number; strand: string};
  /** The primary copy's target ID and 1-based, inclusive span; absent for an unmapped gene. */
  target?: {id: string; seqid: string; start: number; end: number; strand: string};
  transferMethod: string;
  /** The lowest protein identity over the gene's transcripts, as a fraction; absent without a protein. */
  proteinIdentity?: number;
  mutations: string[];
  category: ProteinCategory;
  liftonStatus: string[];
  /** Absent for an unmapped gene, which has no target CDS. */
  unresolvedBases?: number;
  reasons: ReviewReason[];
};

const columns = [
  'reference_id', 'feature_type', 'reference_seqid', 'reference_start', 'reference_end', 'reference_strand', 'lifton_category', 'status', 'copy_number', 'target_id', 'target_seqid',
  'target_start', 'target_end', 'target_strand', 'transfer_method', 'minimum_dna_identity',
  'minimum_protein_identity', 'mutations', 'protein_category', 'lifton_status', 'unresolved_bases', 'review_reasons',
] as const;
type Column = typeof columns[number];

export class ProteinTableError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ProteinTableError';
  }
}

function list(value: string): string[] {
  return value === '' ? [] : value.split(',');
}

function gene(row: Record<Column, string>, path: string, line: number): ReviewGene {
  const fail = (message: string): never => {
    throw new ProteinTableError(path, `line ${String(line)}: ${message}`);
  };
  const integer = (value: string, column: Column): number => {
    if (!/^\d+$/.test(value)) {
      fail(`${column} must be a non-negative integer`);
    }
    return Number(value);
  };
  const category = row.protein_category as ProteinCategory;
  if (!proteinCategories.includes(category)) {
    fail(`unknown protein_category '${row.protein_category}'`);
  }
  const reasons = list(row.review_reasons) as ReviewReason[];
  for (const reason of reasons) {
    if (!reviewReasons.includes(reason)) {
      fail(`unknown review reason '${reason}'`);
    }
  }
  const mapped = row.status === 'mapped';
  if (!mapped && row.status !== 'unmapped') {
    fail(`a rated row must be a primary copy or unmapped, not '${row.status}'`);
  }
  let proteinIdentity: number | undefined;
  if (row.minimum_protein_identity !== '') {
    proteinIdentity = Number(row.minimum_protein_identity);
    if (!Number.isFinite(proteinIdentity) || proteinIdentity < 0 || proteinIdentity > 1) {
      fail('minimum_protein_identity must be a fraction from 0 to 1');
    }
  }
  return {
    referenceId: row.reference_id,
    featureType: row.feature_type,
    reference: {seqid: row.reference_seqid, start: integer(row.reference_start, 'reference_start'),
      end: integer(row.reference_end, 'reference_end'), strand: row.reference_strand},
    ...(mapped ? {target: {id: row.target_id, seqid: row.target_seqid, start: integer(row.target_start, 'target_start'),
      end: integer(row.target_end, 'target_end'), strand: row.target_strand}} : {}),
    transferMethod: row.transfer_method,
    ...(proteinIdentity === undefined ? {} : {proteinIdentity}),
    mutations: list(row.mutations),
    category,
    liftonStatus: list(row.lifton_status),
    ...(row.unresolved_bases === '' ? {} : {unresolvedBases: integer(row.unresolved_bases, 'unresolved_bases')}),
    reasons,
  };
}

/** Reads the genes listed for review, in table order. Throws on a table of another shape, and when `signal` aborts. */
export async function readReviewGenes({path, signal}: {path: string; signal?: AbortSignal}): Promise<ReviewGene[]> {
  const lines = createInterface({input: createReadStream(path, {encoding: 'utf8', signal}), crlfDelay: Infinity});
  const genes: ReviewGene[] = [];
  let header: string[] | undefined;
  let line = 0;
  for await (const text of lines) {
    line += 1;
    if (text === '') {
      continue;
    }
    const values = text.split('\t');
    if (!header) {
      header = values;
      const missing = columns.filter(column => !header!.includes(column));
      if (missing.length > 0) {
        throw new ProteinTableError(path, `lacks the columns ${missing.join(', ')}`);
      }
      continue;
    }
    const row = Object.fromEntries(columns.map(column => [column, values[header!.indexOf(column)] ?? ''])) as Record<Column, string>;
    if (row.review_reasons !== '') {
      genes.push(gene(row, path, line));
    }
  }
  if (!header) {
    throw new ProteinTableError(path, 'is empty');
  }
  return genes;
}

/** A gene flagged disrupted, lost, or unmapped is likely a real change unless an unresolved base explains it. */
function likelyReal(gene: ReviewGene): boolean {
  return (gene.reasons.includes('disrupted') || gene.reasons.includes('unmapped_or_lost')) && !gene.reasons.includes('unresolved_bases');
}

/** Likely real changes first, then the rest; within each, by protein identity with no protein first. */
export function reviewOrder(genes: readonly ReviewGene[]): ReviewGene[] {
  return [...genes].sort((left, right) => Number(likelyReal(right)) - Number(likelyReal(left)) ||
    (left.proteinIdentity ?? -1) - (right.proteinIdentity ?? -1));
}

export function filteredGenes(genes: readonly ReviewGene[], filter: ProteinFilter): ReviewGene[] {
  return reviewOrder(filter === 'all' ? genes : genes.filter(gene => gene.reasons.includes(filter)));
}

export const categoryLabels: Record<ProteinCategory, string> = {
  unmapped: 'unmapped',
  lost: 'lost',
  disrupted: 'disrupted',
  inframe_indel: 'in-frame indel',
  substitutions: 'substitutions',
  unchanged: 'unchanged',
};

export const reasonLabels: Record<ReviewReason, string> = {
  unmapped_or_lost: 'unmapped or lost',
  disrupted: 'disrupted',
  below_threshold: 'below threshold',
  unresolved_bases: 'unresolved bases',
};

function position(span: {seqid: string; start: number; end: number; strand: string}): string {
  return `${span.seqid}:${span.start.toLocaleString('en-US')}–${span.end.toLocaleString('en-US')} (${span.strand})`;
}

export function geneLocus(gene: ReviewGene): string {
  return gene.target ? position(gene.target) : '—';
}

export function identityText(gene: ReviewGene): string {
  return gene.proteinIdentity === undefined ? 'no protein' : `${(gene.proteinIdentity * 100).toFixed(1)}%`;
}

/** The facts of one listed gene, shown alike by the CLI's gene detail and the genome view's item card. */
export function geneFacts(gene: ReviewGene): {id: string; label: string; value: string}[] {
  return [
    {id: 'protein.reference_id', label: 'Reference gene', value: gene.referenceId},
    {id: 'protein.reference_locus', label: 'Reference position', value: position(gene.reference)},
    {id: 'protein.target_id', label: 'Target gene', value: gene.target?.id ?? 'not transferred'},
    {id: 'protein.target_locus', label: 'Target position', value: geneLocus(gene)},
    {id: 'protein.reasons', label: 'Review reasons', value: gene.reasons.map(reason => reasonLabels[reason]).join(', ')},
    {id: 'protein.category', label: 'Protein category', value: categoryLabels[gene.category]},
    {id: 'protein.identity', label: 'Protein identity (lowest transcript)', value: identityText(gene)},
    {id: 'protein.mutations', label: 'Mutation classes', value: gene.mutations.join(', ') || '—'},
    {id: 'protein.lifton_status', label: 'LiftOn status', value: gene.liftonStatus.join(', ') || '—'},
    {id: 'protein.transfer_method', label: 'Transfer method', value: gene.transferMethod || '—'},
    {id: 'protein.unresolved_bases', label: 'Unresolved bases in the CDS', value: gene.unresolvedBases === undefined ? '—' : String(gene.unresolvedBases)},
  ];
}
