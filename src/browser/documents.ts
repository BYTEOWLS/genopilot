import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import type {Document} from '../docs/documents.js';
import type {Block, Inline} from '../docs/markdown.js';
import type {DocumentView} from './contract.js';

function spans(block: Block): Inline[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph': return block.content;
    case 'list': return block.items.flat();
    case 'table': return [...block.header.flat(), ...block.rows.flat(2)];
    case 'alert': return block.paragraphs.flat();
    case 'code': return [];
  }
}

export function documentView(title: string, documents: Document[], openId: string, application: {name: string; version: string}): DocumentView {
  return {
    id: createHash('sha256').update(JSON.stringify(documents.map(document => document.sourceUrl ?? document.id))).digest('hex'),
    title,
    provenance: {application, sources: documents.map(document => ({label: document.title, path: document.sourceUrl ? basename(new URL(document.sourceUrl).pathname) : `${document.id}.md`}))},
    content: {
      kind: 'document', openId,
      documents: documents.map(document => {
        const links: Record<string, {documentId: string; anchor: string}> = {};
        for (const span of (document.blocks ?? []).flatMap(spans)) {
          if ('href' in span && span.href && document.sourceUrl) {
            let url: URL;
            try {
              url = new URL(span.href, document.sourceUrl);
            } catch {
              continue;
            }
            const anchor = url.hash.slice(1);
            url.hash = '';
            const target = documents.find(candidate => candidate.sourceUrl === url.href);
            if (target) {
              links[span.href] = {documentId: target.id, anchor};
            }
          }
        }
        return {id: document.id, title: document.title, blocks: document.blocks, links};
      }),
    },
  };
}
