import React from 'react';
import {Box, Text} from 'ink';
import type {ResultPath} from '../../workflows/annotation-transfer/results.js';
import {
  cohortPathKeys,
  isolatePathKeys,
  unresolvedReasons,
  type CohortCounts,
  type CohortResult,
  type IsolateResult,
  type RecordIssue,
  type ReferenceConsensusResult,
} from '../../workflows/reference-consensus/results.js';
import {
  matchesSiteFilter,
  siteCalls,
  siteFilters,
  type CohortSite,
  type CohortSites,
  type SiteFilter,
} from '../../workflows/reference-consensus/sites.js';
import {ParameterList, parameterLabelWidth, type ParameterRow} from '../components/parameter-list.js';
import type {TabDefinition} from '../components/tabs.js';
import {Table} from '../components/table.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

export type ConsensusTabId = 'overview' | 'isolates' | 'cohorts' | 'sites' | 'files' | 'run';

export const consensusTabs: readonly TabDefinition<ConsensusTabId>[] = [
  {id: 'overview', label: 'Overview'},
  {id: 'isolates', label: 'Isolates'},
  {id: 'cohorts', label: 'Iterations'},
  {id: 'sites', label: 'Sites'},
  {id: 'files', label: 'Files'},
  {id: 'run', label: 'Run Details'},
];

/** What the result page shows of a reference-consensus run; the shell owns it with its input. */
export type ConsensusView = {
  tab: ConsensusTabId;
  isolateIndex: number;
  cohortIndex: number;
  /** The selected isolate's detail replaces the isolate list while open. */
  isolateDetail: boolean;
  /** Which loci of the cohort selected on the Iterations tab the Sites tab lists. */
  siteFilter: SiteFilter;
  siteIndex: number;
  /** The selected locus's detail replaces the site list while open. */
  siteDetail: boolean;
};

export function initialConsensusView(result: ReferenceConsensusResult): ConsensusView {
  const active = result.cohorts.findIndex(cohort => cohort.id === result.activeCohortId);
  return {
    tab: 'overview',
    isolateIndex: 0,
    cohortIndex: active >= 0 ? active : result.cohorts.length - 1,
    isolateDetail: false,
    siteFilter: 'tie',
    siteIndex: 0,
    siteDetail: false,
  };
}

/** The loci of one cohort as the Sites tab loads them, on demand. */
export type SitesState =
  | {cohortId: string; state: 'loading'}
  | {cohortId: string; state: 'ready'; sites: CohortSites}
  | {cohortId: string; state: 'failed'; message: string};

/** The support and consensus-sites tables of a cohort, when both exist. */
export function cohortSiteTables(cohort: CohortResult | undefined): {consensusSitesPath: string; supportSitesPath: string} | undefined {
  const consensusSites = cohort?.paths['consensus-sites'];
  const supportSites = cohort?.paths['support-sites'];
  if (!consensusSites?.available || !supportSites?.available) {
    return undefined;
  }
  return {consensusSitesPath: consensusSites.absolutePath, supportSitesPath: supportSites.absolutePath};
}

/** Lines above the first row of a selectable table: its header and the header's rule. */
export const selectableTableHeaderLines = 2;

export type RowSection = {id: string; title: string; rows: ParameterRow[]};

type DateFormatter = (value: string) => string;

function integer(value: number): string {
  return value.toLocaleString('en-US');
}

function share(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function cohortName(cohort: CohortResult): string {
  return cohort.iteration === 1 ? '1 (initial)' : String(cohort.iteration);
}

function pathRow(id: string, label: string, path: ResultPath): ParameterRow {
  return {id, label, value: `${path.path}${path.available ? '' : ' (missing)'}`, muted: !path.available};
}

function votingMethod(value: string): string {
  return value === 'strict-majority' ? 'strict majority' : value;
}

/** The counts of a cohort in display order; the overview and the comparison share them. */
export function countRows(counts: CohortCounts): {id: string; label: string; value: number}[] {
  const reasonLabels: Record<typeof unresolvedReasons[number], string> = {
    tie: 'Unresolved loci: tie',
    no_majority: 'Unresolved loci: no majority',
    no_votes: 'Unresolved loci: no votes',
    few_callable: 'Unresolved loci: too few callable isolates',
  };
  return [
    {id: 'counts.loci_selected', label: 'Selected loci', value: counts.lociSelected},
    {id: 'counts.loci_changed', label: 'Selected loci differing from the backbone', value: counts.lociChanged},
    ...unresolvedReasons.map(reason => ({
      id: `counts.loci_unresolved.${reason}`,
      label: reasonLabels[reason],
      value: counts.lociUnresolved[reason],
    })),
    {id: 'counts.loci_multiallelic', label: 'Multiallelic loci', value: counts.multiallelicLoci},
    {id: 'counts.loci_competing_indel', label: 'Loci with competing indels', value: counts.competingIndelLoci},
    {id: 'counts.bases_backbone_only', label: 'Bases from the backbone vote alone', value: counts.basesBackboneOnly},
    {id: 'counts.bases_iupac', label: 'Bases written as IUPAC codes', value: counts.basesIupac},
    {
      id: 'counts.bases_n',
      label: 'Bases written as N',
      value: Object.values(counts.basesN).reduce((total, count) => total + count, 0),
    },
  ];
}

function settingsRows(cohort: CohortResult): ParameterRow[] {
  if (!cohort.settings || !cohort.voters) {
    return [];
  }
  return [
    {id: 'cohort.voting_method', label: 'Voting method', value: votingMethod(cohort.settings.voting_method)},
    {id: 'backbone.vote', label: 'Backbone votes', value: yesNo(cohort.settings.include_backbone_vote)},
    {id: 'cohort.min_callable_isolates', label: 'Minimum callable isolates', value: String(cohort.settings.min_callable_isolates)},
    {id: 'cohort.unresolved_snp', label: 'Unresolved SNPs written as', value: cohort.settings.unresolved_snp === 'n' ? 'N' : 'IUPAC code'},
    {id: 'cohort.voters', label: `Voting isolates (${String(cohort.voters.length)})`, value: cohort.voters.join(', ')},
  ];
}

function activeCohort(result: ReferenceConsensusResult): CohortResult | undefined {
  return result.cohorts.find(cohort => cohort.id === result.activeCohortId);
}

function overviewSections(result: ReferenceConsensusResult): RowSection[] {
  const backbone = result.backbone;
  const active = activeCohort(result);
  let origin = backbone.origin ?? 'unknown';
  if (backbone.downloaded !== undefined) {
    origin += backbone.downloaded ? ', downloaded in this run' : ', reused from the verified download cache';
  }
  const backboneRows: ParameterRow[] = [
    {id: 'backbone.source', label: 'Source', value: backbone.source === 'ncbi' ? 'NCBI accession' : backbone.source === 'local' ? 'local file' : 'unknown', muted: !backbone.source},
    {id: 'backbone.identity', label: backbone.source === 'ncbi' ? 'Accession' : 'File', value: backbone.accession ?? backbone.path ?? 'not recorded', muted: !(backbone.accession ?? backbone.path)},
    {id: 'backbone.checksum', label: 'SHA-256', value: backbone.sha256 ?? 'not recorded', muted: !backbone.sha256},
    {id: 'backbone.origin', label: 'Origin', value: origin},
  ];
  const cohortRows: ParameterRow[] = active
    ? [{id: 'cohort.active', label: 'Active iteration', value: cohortName(active)}, ...settingsRows(active)]
    : [{id: 'cohort.active', label: 'Active iteration', value: 'none completed yet', muted: true}];
  const sections: RowSection[] = [
    {id: 'backbone', title: 'Backbone', rows: backboneRows},
    {id: 'active-cohort', title: 'Active Cohort', rows: cohortRows},
  ];
  if (active?.counts) {
    sections.push({
      id: 'counts',
      title: 'Consensus',
      rows: countRows(active.counts).map(row => ({id: row.id, label: row.label, value: integer(row.value)})),
    });
  }
  return sections;
}

const isolateColumns: readonly {id: string; label: string}[] = [
  {id: 'isolates.id', label: 'Isolate'},
  {id: 'isolates.wildtype', label: 'Wild type'},
  {id: 'isolates.derived_from', label: 'Derived from'},
  {id: 'isolates.state', label: 'State'},
  {id: 'isolates.mean_depth', label: 'Depth'},
  {id: 'isolates.callable_fraction', label: 'Callable'},
  {id: 'isolates.snps', label: 'SNPs'},
  {id: 'isolates.indels', label: 'Indels'},
  {id: 'isolates.votes', label: 'Votes'},
  {id: 'isolates.candidate', label: 'Candidate'},
];

function wildtype(value: boolean | null): string {
  return value === null ? '—' : yesNo(value);
}

function votes(isolate: IsolateResult, result: ReferenceConsensusResult): boolean {
  return activeCohort(result)?.voters?.includes(isolate.id) ?? false;
}

export function isolateTableRows(result: ReferenceConsensusResult): string[][] {
  return result.isolates.map(isolate => [
    isolate.id,
    wildtype(isolate.wildtype),
    isolate.derivedFrom ?? '—',
    isolate.state,
    isolate.metrics ? isolate.metrics.meanDepth.toFixed(1) : '—',
    isolate.metrics ? share(isolate.metrics.callableFraction) : '—',
    isolate.metrics ? integer(isolate.metrics.snps) : '—',
    isolate.metrics ? integer(isolate.metrics.indels) : '—',
    yesNo(votes(isolate, result)),
    isolate.promotionCandidate ? 'available' : '—',
  ]);
}

const isolatePathLabels: Record<typeof isolatePathKeys[number], string> = {
  'alignment': 'Alignment (BAM)',
  'alignment-index': 'Alignment index',
  'variants': 'Variants (VCF)',
  'variants-index': 'Variants index',
  'callable-mask': 'Callable mask (BED)',
  'consensus-mask': 'N mask (BED)',
  'consensus-fasta': 'Isolate FASTA',
  'consensus-fasta-index': 'Isolate FASTA index',
  'consensus-chain': 'Coordinate chain',
  'metrics': 'Metrics',
  'provenance': 'Provenance',
  'promotion-candidate': 'Promotion candidate',
  'logs': 'Logs',
};

function isolateDetailSections(isolate: IsolateResult, result: ReferenceConsensusResult): RowSection[] {
  const metrics = isolate.metrics;
  const summary: ParameterRow[] = [
    {id: 'isolates.id', label: 'ID', value: isolate.id},
    {id: 'isolate.name', label: 'Name', value: isolate.name},
    {id: 'isolates.wildtype', label: 'Wild type', value: wildtype(isolate.wildtype)},
    {id: 'isolates.derived_from', label: 'Derived from', value: isolate.derivedFrom ?? '—'},
    {id: 'isolates.state', label: 'State', value: isolate.state},
    {id: 'isolates.votes', label: 'Votes in the active cohort', value: yesNo(votes(isolate, result))},
    {id: 'isolates.candidate', label: 'Promotion candidate', value: isolate.promotionCandidate ? 'available' : 'not available'},
  ];
  const quality: ParameterRow[] = metrics ? [
    {id: 'isolate.trimmed', label: 'Reads trimmed by the provider', value: metrics.trimmed},
    {id: 'isolates.mean_depth', label: 'Mean depth (reads per base)', value: metrics.meanDepth.toFixed(1)},
    {id: 'isolate.covered_fraction', label: 'Covered backbone bases', value: share(metrics.coveredFraction)},
    {id: 'isolates.callable_fraction', label: 'Callable backbone bases', value: share(metrics.callableFraction)},
    {id: 'isolates.snps', label: 'PASS SNPs', value: integer(metrics.snps)},
    {id: 'isolates.indels', label: 'PASS indels', value: integer(metrics.indels)},
  ] : [];
  const sections: RowSection[] = [{id: 'isolate', title: 'Isolate', rows: summary}];
  if (quality.length > 0) {
    sections.push({id: 'isolate-quality', title: 'Reads and Calls', rows: quality});
  }
  sections.push({
    id: 'isolate-files',
    title: 'Files',
    rows: isolatePathKeys.map(key => pathRow(`isolate.path.${key}`, isolatePathLabels[key], isolate.paths[key])),
  });
  return sections;
}

const cohortColumns: readonly {id: string; label: string}[] = [
  {id: 'cohorts.iteration', label: 'Iteration'},
  {id: 'cohorts.state', label: 'State'},
  {id: 'cohorts.date', label: 'Date'},
  {id: 'cohorts.voters', label: 'Voters'},
  {id: 'cohorts.reason', label: 'Reason'},
];

export function cohortTableRows(result: ReferenceConsensusResult, formatDateTime: DateFormatter): string[][] {
  return result.cohorts.map(cohort => {
    const date = cohort.finishedAt ?? cohort.decidedAt;
    return [
      `${cohortName(cohort)}${cohort.id === result.activeCohortId ? ' · active' : ''}`,
      cohort.state,
      date ? formatDateTime(date) : '—',
      cohort.voters ? String(cohort.voters.length) : '—',
      cohort.reason ?? '—',
    ];
  });
}

const cohortPathLabels: Record<typeof cohortPathKeys[number], string> = {
  'support-sites': 'Support table (sites)',
  'support-intervals': 'Support table (intervals)',
  'support-summary': 'Support summary',
  'consensus-fasta': 'Cohort consensus FASTA',
  'consensus-sites': 'Consensus sites',
  'consensus-summary': 'Consensus summary',
  'decision': 'Decision',
  'provenance': 'Provenance',
  'logs': 'Logs',
};

function cohortDetailSections(cohort: CohortResult, formatDateTime: DateFormatter): RowSection[] {
  const rows: ParameterRow[] = [{id: 'cohort.state', label: 'State', value: cohort.state}];
  if (cohort.decidedAt) {
    rows.push({id: 'cohort.decided_at', label: 'Decision saved', value: formatDateTime(cohort.decidedAt)});
  }
  if (cohort.finishedAt) {
    rows.push({id: 'cohort.finished_at', label: 'Finished', value: formatDateTime(cohort.finishedAt)});
  }
  if (cohort.reason) {
    rows.push({id: 'cohort.reason', label: 'Reason', value: cohort.reason});
  }
  rows.push(...settingsRows(cohort));
  if (cohort.excluded.length > 0) {
    rows.push({
      id: 'cohort.excluded',
      label: `Excluded isolates (${String(cohort.excluded.length)})`,
      value: cohort.excluded.map(isolate => `${isolate.id} (${isolate.processing})`).join(', '),
    });
  }
  if (cohort.initialAggregated !== undefined) {
    rows.push({id: 'cohort.initial_aggregated', label: 'Initial cohort existed', value: yesNo(cohort.initialAggregated)});
  }
  return [
    {id: 'cohort', title: `Iteration ${cohortName(cohort)}`, rows},
    {
      id: 'cohort-files',
      title: 'Files',
      rows: cohortPathKeys.flatMap(key => {
        const path = cohort.paths[key];
        return path ? [pathRow(`cohort.path.${key}`, cohortPathLabels[key], path)] : [];
      }),
    },
  ];
}

/**
 * The comparison of a cohort with the baseline, the first completed cohort: both values, the
 * change, and the count's label last, where the table lets it wrap.
 */
export function comparisonRows(baseline: CohortCounts, inspected: CohortCounts): string[][] {
  const before = countRows(baseline);
  return countRows(inspected).map((row, index) => {
    const change = row.value - before[index]!.value;
    return [integer(before[index]!.value), integer(row.value), change > 0 ? `+${integer(change)}` : integer(change), row.label];
  });
}

function consensusFileSections(result: ReferenceConsensusResult): RowSection[] {
  return [{
    id: 'consensus-files',
    title: 'Run Records',
    rows: [
      pathRow('run.configuration', 'Run configuration', result.runFiles.configuration),
      pathRow('run.snapshot', 'Isolate snapshot', result.runFiles.snapshot),
      pathRow('run.input_validation', 'Input validation', result.runFiles.inputValidation),
      pathRow('backbone.fasta', 'Resolved backbone FASTA', result.backbone.paths.fasta),
      pathRow('backbone.provenance', 'Backbone provenance', result.backbone.paths.provenance),
    ],
  }];
}

export const siteFilterLabels: Record<SiteFilter, string> = {
  tie: 'ties',
  no_majority: 'no majority',
  competing_indel: 'competing indels',
  unresolved: 'all unresolved loci',
};

export const siteColumns: readonly {id: string; label: string}[] = [
  {id: 'sites.position', label: 'Position'},
  {id: 'sites.backbone_allele', label: 'Backbone'},
  {id: 'sites.alleles', label: 'Alleles: votes'},
  {id: 'sites.outcome', label: 'Outcome'},
  {id: 'sites.flags', label: 'Flags'},
];

/** Rows of the site list longer than this show their alleles shortened; the detail shows them whole. */
const shownAlleleLength = 12;

function shortAllele(allele: string): string {
  return allele.length > shownAlleleLength ? `${allele.slice(0, shownAlleleLength - 1)}…` : allele;
}

function position(site: CohortSite): string {
  return site.end > site.start
    ? `${site.chrom}:${integer(site.start)}–${integer(site.end)}`
    : `${site.chrom}:${integer(site.start)}`;
}

function outcome(site: CohortSite): string {
  if (site.status === 'selected') {
    return `selected ${site.allele === site.backboneAllele ? 'backbone allele' : shortAllele(site.allele)}`;
  }
  return site.reason.replace('_', ' ');
}

export function filteredSites(sites: CohortSites, filter: SiteFilter): CohortSite[] {
  return sites.sites.filter(site => matchesSiteFilter(site, filter));
}

export function siteTableRows(sites: readonly CohortSite[]): string[][] {
  return sites.map(site => [
    position(site),
    shortAllele(site.backboneAllele),
    site.alleles.map((allele, index) => `${shortAllele(allele)}: ${String(site.votes[index] ?? 0)}`).join('  '),
    outcome(site),
    site.flags.join(', ') || '—',
  ]);
}

export function siteDetailSections(site: CohortSite): RowSection[] {
  return [{
    id: 'site',
    title: 'Locus',
    rows: [
      {id: 'sites.position', label: 'Position (backbone)', value: position(site)},
      {id: 'sites.backbone_allele', label: 'Backbone allele', value: site.backboneAllele},
      {id: 'site.backbone_vote', label: 'Backbone voted', value: yesNo(site.backboneVotes > 0)},
      {id: 'sites.outcome', label: 'Outcome', value: outcome(site)},
      {id: 'site.callable', label: 'Voting isolates', value: String(site.callableIsolates)},
      {id: 'site.total_votes', label: 'Votes cast', value: String(site.totalVotes)},
      {id: 'sites.flags', label: 'Flags', value: site.flags.join(', ') || '—'},
    ],
  }];
}

export const siteAlleleColumns: readonly {id: string; label: string}[] = [
  {id: 'site.allele', label: 'Allele'},
  {id: 'site.allele_votes', label: 'Votes'},
];

export const siteVoterColumns: readonly {id: string; label: string}[] = [
  {id: 'isolates.id', label: 'Isolate'},
  {id: 'isolate.name', label: 'Name'},
  {id: 'isolates.wildtype', label: 'Wild type'},
  {id: 'isolates.derived_from', label: 'Derived from'},
  {id: 'site.call', label: 'Vote'},
];

/** Every voter with its snapshot metadata and what it voted for, or why it cast no vote. */
export function siteVoterRows(site: CohortSite, voters: readonly string[], result: ReferenceConsensusResult): string[][] {
  return siteCalls(site, voters).map(({voter, call}) => {
    const isolate = result.isolates.find(candidate => candidate.id === voter);
    const index = /^[0-9]+$/.test(call) ? Number(call) : undefined;
    let vote = `no vote: ${call}`;
    if (index !== undefined) {
      const allele = site.alleles[index] ?? '?';
      vote = index === 0 ? `${allele} (backbone allele)` : allele;
    }
    return [
      voter,
      isolate?.name ?? '—',
      isolate ? wildtype(isolate.wildtype) : '—',
      isolate?.derivedFrom ?? '—',
      vote,
    ];
  });
}

/** Lines of the Sites tab above its table: the cohort and filter line with its margin. */
const sitesHeaderLines = 2;

function SitesTab({
  result,
  cohort,
  sites,
  view,
  visibleRows,
}: {
  result: ReferenceConsensusResult;
  cohort: CohortResult | undefined;
  sites: SitesState | undefined;
  view: ConsensusView;
  visibleRows: number;
}): React.JSX.Element {
  if (!cohort || !cohortSiteTables(cohort)) {
    return (
      <Text color={mutedColor} wrap="wrap">
        {cohort
          ? `Iteration ${cohortName(cohort)} has no support and consensus-sites tables to review. Select a completed iteration on the Iterations tab.`
          : 'No cohort to review yet.'}
      </Text>
    );
  }
  if (!sites || sites.cohortId !== cohort.id || sites.state === 'loading') {
    return <Text>Reading the loci of iteration {cohortName(cohort)}…</Text>;
  }
  if (sites.state === 'failed') {
    return <Text color="yellow" wrap="wrap">The loci of iteration {cohortName(cohort)} cannot be read: {sanitizeTerminalText(sites.message)}</Text>;
  }
  const shown = filteredSites(sites.sites, view.siteFilter);
  const selected = shown[Math.min(view.siteIndex, shown.length - 1)];
  if (view.siteDetail && selected) {
    return (
      <Box flexDirection="column">
        <Sections sections={siteDetailSections(selected)} />
        <Box marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold>Alleles</Text>
          <Table
            header={siteAlleleColumns.map(column => column.label)}
            rows={selected.alleles.map((allele, index) => [allele, String(selected.votes[index] ?? 0)])}
          />
        </Box>
        <Box marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold>Voters</Text>
          <Table header={siteVoterColumns.map(column => column.label)} rows={siteVoterRows(selected, sites.sites.voters, result)} />
        </Box>
      </Box>
    );
  }
  const counts = siteFilters.map(filter => `${siteFilterLabels[filter]} ${String(filteredSites(sites.sites, filter).length)}`);
  const rowsShown = Math.max(1, visibleRows - sitesHeaderLines - selectableTableHeaderLines - 1);
  const first = Math.max(0, Math.min(view.siteIndex - Math.floor(rowsShown / 2), shown.length - rowsShown));
  const window = shown.slice(first, first + rowsShown);
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        Iteration {cohortName(cohort)} · showing <Text bold>{siteFilterLabels[view.siteFilter]}</Text>
        <Text color={mutedColor}> ({counts.join(' · ')})</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {shown.length === 0 ? (
          <Text color={mutedColor}>No locus of this iteration is one of the {siteFilterLabels[view.siteFilter]}.</Text>
        ) : (
          <>
            <Table
              header={siteColumns.map(column => column.label)}
              rows={siteTableRows(window)}
              selectedRow={Math.min(view.siteIndex, shown.length - 1) - first}
            />
            {shown.length > window.length ? (
              <Text color={mutedColor}>{'  '}loci {String(first + 1)}–{String(first + window.length)} of {String(shown.length)}</Text>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}

/** Every item ID the view can render, with its label, grouped like the tabs. */
function Sections({sections}: {sections: readonly RowSection[]}): React.JSX.Element {
  const labelWidth = parameterLabelWidth(sections.flatMap(section => section.rows));
  return (
    <Box flexDirection="column">
      {sections.map(section => (
        <Box key={section.id} marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold>{section.title}</Text>
          <ParameterList rows={section.rows} inputActive={false} labelWidth={labelWidth} />
        </Box>
      ))}
    </Box>
  );
}

function Issues({issues}: {issues: readonly RecordIssue[]}): React.JSX.Element | null {
  if (issues.length === 0) {
    return null;
  }
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text color="yellow" bold>Records that cannot be interpreted</Text>
      {issues.map(issue => (
        <Text key={`${issue.path}:${issue.message}`} color="yellow" wrap="wrap">
          {'! '}{sanitizeTerminalText(issue.path)}: {sanitizeTerminalText(issue.message)}
        </Text>
      ))}
    </Box>
  );
}

function Comparison({result, cohort}: {result: ReferenceConsensusResult; cohort: CohortResult}): React.JSX.Element | null {
  const baseline = result.cohorts.find(candidate => candidate.id === result.baselineCohortId);
  if (!baseline?.counts || !cohort.counts || baseline.id === cohort.id) {
    return null;
  }
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text bold>Compared with iteration {cohortName(baseline)}</Text>
      <Table
        header={[`Iteration ${String(baseline.iteration)}`, `Iteration ${String(cohort.iteration)}`, 'Change', 'Count']}
        rows={comparisonRows(baseline.counts, cohort.counts)}
      />
    </Box>
  );
}

/**
 * The tab content of a reference-consensus result. Selectable tables come first in their tab, so
 * the shell can keep the selected row in view from its index alone.
 */
export function ReferenceConsensusResults({
  result,
  view,
  formatDateTime,
  overviewHeader,
  filesHeader,
  runDetails,
  sites,
  visibleRows = 20,
}: {
  result: ReferenceConsensusResult;
  view: ConsensusView;
  formatDateTime: DateFormatter;
  /** The loci of the cohort selected on the Iterations tab, once the Sites tab asked for them. */
  sites?: SitesState;
  /** Rows the tab content may use; the Sites tab fits its list into them instead of scrolling. */
  visibleRows?: number;
  /** The execution outcome and run status, shown above the overview. */
  overviewHeader: React.ReactNode;
  /** Run directory and run files, shown above the workflow's own records. */
  filesHeader: React.ReactNode;
  /** The run's technical metadata, on a tab of its own. */
  runDetails: React.ReactNode;
}): React.JSX.Element {
  switch (view.tab) {
    case 'overview':
      return (
        <Box flexDirection="column">
          {overviewHeader}
          {result.initialNotAggregatedReason ? (
            <Box marginTop={1}>
              <Text color="yellow" wrap="wrap">
                The initial cohort of all selected isolates was never aggregated. The first decision explains why:{' '}
                {sanitizeTerminalText(result.initialNotAggregatedReason)}
              </Text>
            </Box>
          ) : null}
          <Sections sections={overviewSections(result)} />
          <Issues issues={result.backbone.issues} />
        </Box>
      );
    case 'isolates': {
      const isolate = result.isolates[view.isolateIndex];
      if (view.isolateDetail && isolate) {
        return (
          <Box flexDirection="column">
            <Sections sections={isolateDetailSections(isolate, result)} />
            <Issues issues={isolate.issues} />
          </Box>
        );
      }
      return (
        <Box flexDirection="column">
          <Table
            header={isolateColumns.map(column => column.label)}
            rows={isolateTableRows(result)}
            selectedRow={view.isolateIndex}
          />
        </Box>
      );
    }
    case 'cohorts': {
      const cohort = result.cohorts[view.cohortIndex];
      return (
        <Box flexDirection="column">
          <Table
            header={cohortColumns.map(column => column.label)}
            rows={cohortTableRows(result, formatDateTime)}
            selectedRow={view.cohortIndex}
          />
          {cohort ? (
            <>
              <Sections sections={cohortDetailSections(cohort, formatDateTime)} />
              <Comparison result={result} cohort={cohort} />
              <Issues issues={cohort.issues} />
            </>
          ) : null}
        </Box>
      );
    }
    case 'sites':
      return (
        <SitesTab
          result={result}
          cohort={result.cohorts[view.cohortIndex]}
          sites={sites}
          view={view}
          visibleRows={visibleRows}
        />
      );
    case 'files':
      return (
        <Box flexDirection="column">
          {filesHeader}
          <Sections sections={consensusFileSections(result)} />
        </Box>
      );
    case 'run':
      return <Box flexDirection="column">{runDetails}</Box>;
  }
}
