import type {Block} from '../docs/markdown.js';
import type {FileSnapshot} from './fasta-index.js';

export const browserViewShortcut = 'v — View in browser';
export type BrowserDocument = {
  id: string;
  title: string;
  blocks?: Block[];
  links: Record<string, {documentId: string; anchor: string}>;
};
export type ViewProvenance = {application: {name: string; version: string}; sources: {label: string; path: string; sha256?: string}[]};
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
  kind: 'annotation';
  format: 'gff3' | 'bed';
  /** Absolute paths from the caller; replaced by opaque URLs before publication. */
  file: string;
  /** Checksum-verified file identity from the caller; removed before publication. */
  snapshot?: FileSnapshot;
  shown: boolean;
  size?: number;
  problem?: string;
};
export type GenomeView = {
  id: string;
  title: string;
  provenance: ViewProvenance;
  content: {
    kind: 'genome';
    reference: {name: string; fasta: string; index?: string; sequences?: GenomeSequence[]; snapshot?: FileSnapshot};
    tracks: GenomeTrack[];
    legend?: BrowserDocument;
  };
};
export type BrowserView = DocumentView | GenomeView;
export type BrowserState = {view?: BrowserView; navigationAvailable: boolean; message?: string};
