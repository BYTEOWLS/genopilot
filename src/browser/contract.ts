import type {Block} from '../docs/markdown.js';

export const browserViewShortcut = 'v — View in browser';
export type BrowserDocument = {
  id: string;
  title: string;
  blocks?: Block[];
  links: Record<string, {documentId: string; anchor: string}>;
};
export type DocumentView = {
  id: string;
  title: string;
  provenance: {application: {name: string; version: string}; sources: {label: string; path: string}[]};
  content: {kind: 'document'; documents: BrowserDocument[]; openId: string};
};
export type BrowserState = {view?: DocumentView; navigationAvailable: boolean; message?: string};
