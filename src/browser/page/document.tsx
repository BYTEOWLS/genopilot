import React, {useEffect, useState} from 'react';
import {Button} from '@mantine/core';
import {inlineText, markdownSection, plainText, type Block, type Inline} from '../../docs/markdown.js';
import type {BrowserDocument} from '../contract.js';

export function headingAnchors(blocks: Block[]): Map<number, string> {
  const anchors = new Map<number, string>();
  const counts = new Map<string, number>();
  blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      const base = inlineText(block.content).toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      anchors.set(index, count === 0 ? base : `${base}-${count}`);
    }
  });
  return anchors;
}
export function InlineContent({spans, document, select}: {spans: Inline[]; document: BrowserDocument; select: (id: string, anchor?: string) => void}): React.JSX.Element {
  return <>{spans.map((span, index) => {
    const content = span.kind === 'code' ? <code>{span.text}</code> : span.kind === 'bold' ? <strong>{span.text}</strong> : span.kind === 'italic' ? <em>{span.text}</em> : span.text;
    if ('href' in span && span.href) {
      const target = document.links[span.href];
      if (target) {
        return <a key={index} href={`#${target.anchor}`} onClick={event => {event.preventDefault(); select(target.documentId, target.anchor);}}>{content}</a>;
      }
      if (/^https?:\/\//i.test(span.href)) {
        return <a key={index} href={span.href} target="_blank" rel="noopener noreferrer">{content}</a>;
      }
      return <span key={index}>{content} <span className="document-muted">({span.href})</span></span>;
    }
    return <React.Fragment key={index}>{content}</React.Fragment>;
  })}</>;
}
/**
 * Copies plain text for pasting into a manuscript. Where the clipboard is refused, it says so and
 * shows the text selected for a manual copy.
 */
function CopyButton({label, text}: {label: string; text: string}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // "Copied" confirms one copy and then turns back into the button's label.
  useEffect(() => {
    if (state !== 'copied') {
      return;
    }
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return <span className="copy-control">
    <Button variant="default" size="xs" onClick={() => void copy()}>{state === 'copied' ? 'Copied' : label}</Button>
    {state === 'failed' ? <>
      <span role="alert" className="document-muted">Copying failed; the text is selected for copying by hand.</span>
      <textarea className="copy-fallback" readOnly value={text} autoFocus onFocus={event => event.currentTarget.select()} aria-label={label} />
    </> : null}
  </span>;
}
export function DocumentBody({document, select}: {document: BrowserDocument; select: (id: string, anchor?: string) => void}): React.JSX.Element {
  if (!document.blocks) {
    return <p role="status">No documentation is available for {document.title}.</p>;
  }
  const anchors = headingAnchors(document.blocks);
  const blocks = document.blocks;
  const inline = (spans: Inline[]) => <InlineContent spans={spans} document={document} select={select} />;
  // A copyable document offers itself and each `##` section, without its heading, as plain text.
  const copy = (index: number) => {
    const block = blocks[index];
    if (!document.copyable || block?.kind !== 'heading' || block.level > 2) {
      return null;
    }
    const text = block.level === 1 ? plainText(blocks) : plainText(markdownSection(blocks, index).slice(1));
    return <CopyButton label={block.level === 1 ? 'Copy all' : `Copy ${inlineText(block.content)}`} text={text} />;
  };
  return <article className="document">{blocks.map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3';
        return <React.Fragment key={index}><Heading id={anchors.get(index)}>{inline(block.content)}</Heading>{copy(index)}</React.Fragment>;
      }
      case 'paragraph': return <p key={index}>{inline(block.content)}</p>;
      case 'code': return <pre key={index}><code>{block.text}</code></pre>;
      case 'list': {
        const List = block.ordered ? 'ol' : 'ul';
        return <List key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</List>;
      }
      case 'table': return <div key={index} className="table-scroll" tabIndex={0} role="region" aria-label="Documentation table"><table><thead><tr>{block.header.map((cell, i) => <th key={i} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
      case 'alert': return <aside key={index} className="alert"><strong>{block.variant[0]?.toUpperCase()}{block.variant.slice(1)}</strong>{block.paragraphs.map((paragraph, i) => <p key={i}>{inline(paragraph)}</p>)}</aside>;
    }
  })}</article>;
}
