import type {Block} from '../docs/markdown.js';
import type {FileSnapshot} from './fasta-index.js';

export const browserViewShortcut = 'v — View in browser';
/** A view's headline: the CLI place it was opened from, then what it shows, such as `Accession catalog: <genome>`. */
export function viewTitle(...parts: string[]): string {
  return parts.join(': ');
}
/** The headline of a view opened from a run's results. */
export function runViewTitle(workflow: {label: string}, run: {id: string; name?: string}, part: string): string {
  return viewTitle(`Workflow "${workflow.label}"`, run.name || run.id, part);
}
export type BrowserDocument = {
  id: string;
  title: string;
  blocks?: Block[];
  links: Record<string, {documentId: string; anchor: string}>;
};
export type ViewProvenance = {
  application: {name: string; version: string};
  run?: {id: string; name?: string; workflow: {id: string; version: number}};
  sources: {label: string; path: string; sha256?: string}[];
};
export type DocumentView = {
  id: string;
  title: string;
  provenance: ViewProvenance;
  content: {kind: 'document'; documents: BrowserDocument[]; openId: string};
};
export type GenomeSequence = {name: string; length: number};
export type GenomeTrack = {
  id: string;
  name: string;
  kind: 'annotation' | 'alignment' | 'variant';
  format: 'gff3' | 'bed' | 'bam' | 'vcf';
  index?: string;
  group?: string;
  /** Absolute paths from the caller; replaced by opaque URLs before publication. */
  file: string;
  /** Checksum-verified file identity from the caller; removed before publication. */
  snapshot?: FileSnapshot;
  shown: boolean;
  size?: number;
  problem?: string;
};
export type GenomeTarget = {chrom: string; start: number; end: number; tracks?: {id: string; shown: boolean; name?: string}[]};
export type GenomeItem = {
  id: string;
  label: string;
  target: GenomeTarget;
  details?: {title: string; rows: {label: string; value: string}[]}[];
};
export type GenomePreset = {id: string; label: string; padding: number; reads: boolean; colorBy?: 'strand'};
export type GenomeView = {
  id: string;
  title: string;
  provenance: ViewProvenance;
  /** `itemName` names one item in the page, such as `gene`; `locus` when absent. */
  items?: {name: string; itemName?: string; entries: GenomeItem[]};
  selectedItemId?: string;
  guide?: BrowserDocument;
  content: {
    kind: 'genome';
    reference: {name: string; fasta: string; index?: string; sequences?: GenomeSequence[]; snapshot?: FileSnapshot};
    tracks: GenomeTrack[];
    presets?: GenomePreset[];
    legend?: BrowserDocument;
  };
};
export type BrowserView = DocumentView | GenomeView;
export type BrowserState = {view?: BrowserView; navigationAvailable: boolean; message?: string};
