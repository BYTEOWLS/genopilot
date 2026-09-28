import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createGunzip} from 'node:zlib';

/**
 * Reader of a cohort's reviewable loci for the Sites tab of the results (consensus Task 5.3).
 *
 * `consensus-sites.tsv.gz` holds each locus's outcome; `support-sites.tsv.gz` holds its votes per
 * voter. The consensus table has one `locus` row per row of the support table, in the same order,
 * and `region` rows in between, so both are streamed side by side once, and only the loci worth
 * reviewing are kept. Both are bgzip files, which gunzip reads as concatenated gzip members.
 */

export type SiteFilter = 'tie' | 'no_majority' | 'competing_indel' | 'unresolved';
export const siteFilters: readonly SiteFilter[] = ['tie', 'no_majority', 'competing_indel', 'unresolved'];

export type CohortSite = {
  chrom: string;
  /** 1-based, inclusive backbone coordinates. */
  start: number;
  end: number;
  status: 'selected' | 'unresolved';
  /** `tie`, `no_majority`, `no_votes`, or `few_callable` when unresolved; `.` when selected. */
  reason: string;
  /** The selected allele, or `.`. */
  allele: string;
  backboneAllele: string;
  backboneVotes: number;
  /** The backbone allele first, then by votes; `votes` lists theirs in the same order. */
  alleles: string[];
  votes: number[];
  callableIsolates: number;
  totalVotes: number;
  flags: string[];
  /** The support row's per-voter columns, split only when the locus is inspected; see `siteCalls`. */
  calls: string;
};

export type CohortSites = {
  /** The voters in the column order of the support table. */
  voters: string[];
  sites: CohortSite[];
};

const consensusColumns = [
  'chrom', 'start', 'end', 'consensus_start', 'consensus_end', 'kind', 'status', 'reason', 'allele',
  'written', 'backbone_allele', 'alleles', 'allele_votes', 'callable_isolates', 'total_votes', 'flags',
] as const;
const supportColumns = [
  'chrom', 'start', 'end', 'backbone_allele', 'backbone_votes', 'alleles', 'allele_votes',
  'callable_isolates', 'total_votes', 'flags',
] as const;
const voterColumnPrefix = 'isolate:';

export function matchesSiteFilter(site: CohortSite, filter: SiteFilter): boolean {
  switch (filter) {
    case 'tie':
    case 'no_majority':
      return site.status === 'unresolved' && site.reason === filter;
    case 'competing_indel':
      return site.flags.includes('competing_indel');
    case 'unresolved':
      return site.status === 'unresolved';
  }
}

/**
 * Every voter's entry at a locus: the index into `alleles` of the allele it voted for, or its
 * state when it cast no vote (`ambiguous`, `uncallable`, or `unsupported`).
 */
export function siteCalls(site: CohortSite, voters: readonly string[]): {voter: string; call: string}[] {
  const calls = site.calls.split('\t');
  return voters.map((voter, index) => ({voter, call: calls[index] ?? '?'}));
}

class TableError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'TableError';
  }
}

/** The lines of a gzip table after its header, and the header's columns. */
async function* tableLines(
  path: string,
  expected: readonly string[],
  onHeader: (columns: string[]) => void,
  signal?: AbortSignal,
): AsyncGenerator<string[]> {
  const source = createReadStream(path);
  const gunzip = createGunzip();
  const lines = createInterface({input: source.pipe(gunzip), crlfDelay: Infinity});
  source.on('error', error => gunzip.destroy(error));
  let header = false;
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (line.startsWith('##') || line.length === 0) {
        continue;
      }
      const fields = line.split('\t');
      if (!header) {
        if (!line.startsWith('#') || expected.some((column, index) => fields[index]?.replace(/^#/, '') !== column)) {
          throw new TableError(path, `does not start with the columns ${expected.join(', ')}`);
        }
        onHeader(fields.map(field => field.replace(/^#/, '')));
        header = true;
        continue;
      }
      yield fields;
    }
    if (!header) {
      throw new TableError(path, 'has no header line');
    }
  } finally {
    lines.close();
    source.destroy();
  }
}

function integer(value: string | undefined): number {
  return Number.parseInt(value ?? '', 10);
}

function list(value: string | undefined): string[] {
  return value === undefined || value === '.' || value === '' ? [] : value.split(',');
}

/**
 * Reads the unresolved and competing-indel loci of one cohort, with the voters' support. Throws
 * when the tables do not belong together, and when `signal` aborts.
 */
export async function readCohortSites({
  consensusSitesPath,
  supportSitesPath,
  signal,
}: {
  consensusSitesPath: string;
  supportSitesPath: string;
  signal?: AbortSignal;
}): Promise<CohortSites> {
  let voters: string[] = [];
  const support = tableLines(supportSitesPath, supportColumns, columns => {
    voters = columns.slice(supportColumns.length).map(column => column.startsWith(voterColumnPrefix)
      ? column.slice(voterColumnPrefix.length)
      : column);
  }, signal);
  const sites: CohortSite[] = [];
  try {
    for await (const row of tableLines(consensusSitesPath, consensusColumns, () => undefined, signal)) {
      if (row[5] !== 'locus') {
        continue;
      }
      const next = await support.next();
      const votes = next.value;
      if (next.done || !votes || votes[0] !== row[0] || votes[1] !== row[1] || votes[2] !== row[2]) {
        throw new TableError(
          consensusSitesPath,
          `locus ${String(row[0])}:${String(row[1])} has no matching row in ${supportSitesPath}`,
        );
      }
      const flags = list(row[15]);
      const status = row[6] === 'unresolved' ? 'unresolved' : 'selected';
      if (status !== 'unresolved' && !flags.includes('competing_indel')) {
        continue;
      }
      sites.push({
        chrom: row[0] ?? '',
        start: integer(row[1]),
        end: integer(row[2]),
        status,
        reason: row[7] ?? '.',
        allele: row[8] ?? '.',
        backboneAllele: row[10] ?? '',
        backboneVotes: integer(votes[4]),
        alleles: list(row[11]),
        votes: list(row[12]).map(value => integer(value)),
        callableIsolates: integer(row[13]),
        totalVotes: integer(row[14]),
        flags,
        calls: votes.slice(supportColumns.length).join('\t'),
      });
    }
    const rest = await support.next();
    if (!rest.done) {
      throw new TableError(supportSitesPath, 'has more loci than the consensus sites table');
    }
  } finally {
    await support.return(undefined);
  }
  return {voters, sites};
}
