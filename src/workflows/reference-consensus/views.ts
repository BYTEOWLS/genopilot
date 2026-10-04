import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {readCatalogedAccessions, type AccessionCatalogReader} from '../../accessions/store.js';
import {recordedCacheState} from '../../accessions/catalog.js';
import {inlineText, markdownSection} from '../../docs/markdown.js';
import {verifyFileChecksum} from '../../browser/verified-file.js';
import {isRecord} from '../configuration-validation.js';
import type {BrowserDocument, GenomeItem, GenomeTrack, GenomeView, ViewProvenance} from '../../browser/contract.js';
import type {ReferenceConsensusConfiguration} from './configuration.js';
import type {CohortResult, IsolateResult, ReferenceConsensusResult} from './results.js';
import {siteCalls, type CohortSite, type CohortSites} from './sites.js';

export function siteItemId(site: CohortSite): string {
  return JSON.stringify([site.chrom, site.start, site.end]);
}

function evidenceTracks(isolate: IsolateResult, shown: boolean): GenomeTrack[] {
  return [
    {id: `${isolate.id}:reads`, name: `${isolate.name} · reads`, kind: 'alignment', format: 'bam', file: isolate.paths.alignment.absolutePath,
      index: isolate.paths['alignment-index'].absolutePath, group: isolate.id, shown},
    {id: `${isolate.id}:variants`, name: `${isolate.name} · variants`, kind: 'variant', format: 'vcf', file: isolate.paths.variants.absolutePath,
      index: isolate.paths['variants-index'].absolutePath, group: isolate.id, shown},
    {id: `${isolate.id}:mask`, name: `${isolate.name} · consensus mask`, kind: 'annotation', format: 'bed', file: isolate.paths['consensus-mask'].absolutePath,
      group: isolate.id, shown: false},
  ];
}

function reviewItem(site: CohortSite, sites: CohortSites, result: ReferenceConsensusResult): GenomeItem {
  const calls = siteCalls(site, sites.voters);
  const ordered = [...calls].sort((left, right) => {
    const rank = (call: string): number => /^\d+$/.test(call) ? Number(call) : Number.MAX_SAFE_INTEGER;
    return rank(left.call) - rank(right.call);
  });
  const byId = new Map(result.isolates.map(isolate => [isolate.id, isolate]));
  const tracks = ordered.flatMap(({voter, call}) => {
    const isolate = byId.get(voter);
    if (!isolate) {
      return [];
    }
    const voted = /^\d+$/.test(call);
    const vote = voted ? `vote ${site.alleles[Number(call)] ?? '?'}` : `no vote: ${call}`;
    return evidenceTracks(isolate, false).map(track => ({id: track.id,
      shown: track.kind === 'variant' || (track.kind === 'alignment' ? voted : !voted),
      name: `${isolate.name} · ${vote} · ${track.kind === 'alignment' ? 'reads' : track.kind === 'variant' ? 'variants' : 'mask'}`}));
  });
  const voting = new Set(sites.voters);
  for (const isolate of result.isolates) {
    if (!voting.has(isolate.id)) {
      tracks.push(...evidenceTracks(isolate, false).map(track => ({id: track.id, shown: false, name: `${track.name} · not voting`})));
    }
  }
  const label = `${site.chrom}:${site.start}-${site.end}`;
  return {id: siteItemId(site), label, target: {chrom: site.chrom, start: site.start, end: site.end, tracks}, details: [
    {title: 'Locus', rows: [
      {label: 'Position (backbone)', value: label},
      {label: 'Backbone allele', value: site.backboneAllele},
      {label: 'Backbone voted', value: site.backboneVotes > 0 ? 'yes' : 'no'},
      {label: 'Outcome', value: site.status === 'unresolved' ? site.reason : `selected ${site.allele}`},
      {label: 'Voting isolates', value: String(site.callableIsolates)},
      {label: 'Votes cast', value: String(site.totalVotes)},
      {label: 'Flags', value: site.flags.join(', ') || '—'},
    ]},
    {title: 'Alleles', rows: site.alleles.map((allele, index) => ({label: allele, value: `${site.votes[index] ?? 0} votes`}))},
    {title: 'Isolates', rows: calls.map(({voter, call}) => ({label: byId.get(voter)?.name ?? voter,
      value: /^\d+$/.test(call) ? site.alleles[Number(call)] ?? '?' : `no vote: ${call}`}))},
  ]};
}

type Context = {result: ReferenceConsensusResult; configuration: ReferenceConsensusConfiguration; application: ViewProvenance['application']; workflow: {id: string; version: number}};
function base(context: Context, suffix: string, title: string, reference: GenomeView['content']['reference'], tracks: GenomeTrack[]): GenomeView {
  const {configuration, application, workflow} = context;
  return {id: createHash('sha256').update(JSON.stringify([context.result.runFiles.configuration.absolutePath, suffix])).digest('hex'), title,
    provenance: {application, run: {id: configuration.run.id, name: configuration.run.name, workflow}, sources: [
      {label: 'Reference', path: reference.fasta, ...(reference.fasta === context.result.backbone.paths.fasta.absolutePath && context.result.backbone.sha256 ? {sha256: context.result.backbone.sha256} : {})},
      ...tracks.flatMap(track => [{label: track.name, path: track.file}, ...(track.index ? [{label: `${track.name} index`, path: track.index}] : [])]),
    ]}, content: {kind: 'genome', reference, tracks}};
}

async function verifiedBackbone(context: Context & {signal?: AbortSignal}): Promise<GenomeView['content']['reference']> {
  const backbone = context.result.backbone;
  if (!backbone.sha256 || backbone.issues.length > 0) {
    throw new Error('The backbone has no usable checksum provenance.');
  }
  const fasta = backbone.paths.fasta.absolutePath;
  const snapshot = await verifyFileChecksum(fasta, backbone.sha256, context.signal);
  return {name: backbone.accession ?? 'Backbone', fasta, snapshot,
    ...(existsSync(`${fasta}.fai`) ? {index: `${fasta}.fai`} : {})};
}

/** Every alignment, variant, mask and review locus is in backbone coordinates. */
export async function consensusSitesView(context: Context & {cohort: CohortResult; sites: CohortSites; listed: CohortSite[]; selected?: CohortSite; guide?: BrowserDocument; signal?: AbortSignal; readAccessions?: AccessionCatalogReader}): Promise<GenomeView> {
  const {result, cohort, sites, listed, selected, guide} = context;
  const backbone = result.backbone;
  const reference = await verifiedBackbone(context);
  const view = base(context, `sites:${cohort.id}:${createHash('sha256').update(JSON.stringify(listed.map(siteItemId))).digest('hex')}`, `Iteration ${cohort.iteration} · loci`,
    reference, result.isolates.flatMap(isolate => evidenceTracks(isolate, false)));
  view.provenance.sources[0]!.label = `Verified ${backbone.origin ?? 'imported'} backbone`;
  if (backbone.accession) {
    const entries = await (context.readAccessions ?? readCatalogedAccessions)().catch(() => []);
    context.signal?.throwIfAborted();
    const entry = entries.find(entry => entry.accession === backbone.accession && recordedCacheState(entry) === 'cached');
    const copy = entry?.cached_copies.find(copy => copy.fasta_sha256 === backbone.sha256 && copy.gff3_sha256);
    if (copy?.gff3_sha256) {
      const file = join(copy.path, 'genomic.gff');
      const annotation: GenomeTrack = {id: 'backbone-annotation', name: 'Backbone annotation', kind: 'annotation', format: 'gff3', file, shown: false};
      try {
        annotation.snapshot = await verifyFileChecksum(file, copy.gff3_sha256, context.signal);
        annotation.shown = true;
        view.provenance.sources.push({label: 'Verified imported backbone annotation', path: file, sha256: copy.gff3_sha256});
      } catch (error) {
        context.signal?.throwIfAborted();
        annotation.problem = `${file}: annotation verification failed: ${error instanceof Error ? error.message : String(error)}`;
        view.provenance.sources.push({label: 'Unavailable imported backbone annotation', path: file});
      }
      view.content.tracks.unshift(annotation);
    }
  }
  const blocks = guide?.blocks ?? [];
  const guideStart = blocks.findIndex(block => block.kind === 'heading' && inlineText(block.content) === 'Sites genome review');
  const guideHeading = blocks[guideStart];
  const reviewGuide = guide && guideHeading?.kind === 'heading' ? {...guide, title: inlineText(guideHeading.content), blocks: markdownSection(blocks, guideStart)} : undefined;
  view.provenance.sources.push(...['support-sites', 'consensus-sites'].flatMap(key => {
    const path = cohort.paths[key as 'support-sites' | 'consensus-sites'];
    return path ? [{label: key, path: path.path}] : [];
  }));
  return {...view, items: {name: 'Loci', entries: listed.map(site => {
    const item = reviewItem(site, sites, result);
    item.target.tracks?.unshift(...view.content.tracks.filter(track => !track.group).map(track => ({id: track.id, shown: track.shown})));
    return item;
  })}, selectedItemId: selected ? siteItemId(selected) : undefined, guide: reviewGuide,
    content: {...view.content, presets: [
      {id: 'reads', label: 'Reads by allele', padding: 50, reads: true},
      {id: 'votes', label: 'Votes', padding: 50, reads: false},
      {id: 'strand', label: 'Reads by strand', padding: 50, reads: true, colorBy: 'strand'},
      {id: 'region', label: 'Region', padding: 3000, reads: false},
    ]}};
}

/** The isolate FASTA is not overlaid on its backbone-coordinate evidence. */
export async function consensusIsolateView(context: Context & {isolate: IsolateResult; signal?: AbortSignal}): Promise<GenomeView> {
  const backbone = context.result.backbone;
  const reference = await verifiedBackbone(context);
  const view = base(context, `isolate:${context.isolate.id}`, `${context.isolate.name} · backbone evidence`,
    reference, evidenceTracks(context.isolate, true));
  view.provenance.sources[0]!.label = `Verified ${backbone.origin ?? 'imported'} backbone`;
  return view;
}

/** Indels change coordinates: the cohort consensus is a separate reference without backbone tracks. */
export async function cohortConsensusView(context: Context & {cohort: CohortResult; signal?: AbortSignal}): Promise<GenomeView> {
  const fasta = context.cohort.paths['consensus-fasta'];
  const summary = context.cohort.paths['consensus-summary'];
  if (context.cohort.state !== 'completed' || !fasta?.available || !summary?.available) {
    throw new Error('This iteration has no completed consensus with checksum provenance.');
  }
  const record: unknown = JSON.parse(await readFile(summary.absolutePath, {encoding: 'utf8', signal: context.signal}));
  const outputs = isRecord(record) && record.schema_version === 1 && isRecord(record.outputs) ? record.outputs : undefined;
  const output = outputs && isRecord(outputs.fasta) ? outputs.fasta : undefined;
  if (!output || typeof output.path !== 'string' || typeof output.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(output.sha256) ||
      resolve(dirname(context.result.runFiles.configuration.absolutePath), output.path) !== fasta.absolutePath) {
    throw new Error(`Consensus summary has no matching FASTA checksum: ${summary.path}`);
  }
  const snapshot = await verifyFileChecksum(fasta.absolutePath, output.sha256, context.signal);
  const view = base(context, `consensus:${context.cohort.id}`, `Iteration ${context.cohort.iteration} · cohort consensus`,
    {name: `Consensus · ${context.cohort.id}`, fasta: fasta.absolutePath,
      ...(existsSync(`${fasta.absolutePath}.fai`) ? {index: `${fasta.absolutePath}.fai`} : {}), snapshot}, []);
  view.provenance.sources[0] = {label: 'Verified generated cohort consensus', path: fasta.path, sha256: output.sha256};
  view.provenance.sources.push({label: 'Consensus summary', path: summary.path});
  return view;
}
