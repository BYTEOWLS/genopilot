import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseMarkdown} from '../../src/docs/markdown.js';
import {documentView} from '../../src/browser/documents.js';
import {DocumentBody, headingAnchors} from '../../src/browser/page/document.js';

test('builder resolves only links to the supplied documents without exposing file URLs', () => {
  const source = '[Other](two.md#section) [`file`](two.md) [Elsewhere](../outside.md)';
  const view = documentView('Test', [
    {id: 'one', title: 'One', blocks: parseMarkdown(source), sourceUrl: 'file:///private/docs/one.md'},
    {id: 'two', title: 'Two', sourceUrl: 'file:///private/docs/two.md'},
  ], 'one', {name: 'Test', version: 'test'});
  assert.deepEqual(view.content.documents[0]?.links, {
    'two.md#section': {documentId: 'two', anchor: 'section'},
    'two.md': {documentId: 'two', anchor: ''},
  });
  // The stable view ID is opaque, not a source path.
  assert.ok(!JSON.stringify(view).includes('/private/'));
});

test('HTML renderer covers every block, escapes text, and refuses executable links', () => {
  const blocks = parseMarkdown('# Title\n\n## Section\n\n## Section\n\n### Detail\n\nText **bold** *italic* `code` <script>bad</script> [external](https://example.org) [bad](javascript:alert) [relative](outside.md)\n\n- bullet\n\n1. ordered\n\n| A | B |\n|---|---|\n| X | Y |\n\n```\n<tag>\n```\n\n> [!WARNING]\n> Caution.');
  const html = renderToStaticMarkup(<DocumentBody document={{id: 'test', title: 'Test', blocks, links: {}}} select={() => {}} />);
  for (const element of ['h1', 'h2', 'h3', 'p', 'strong', 'em', 'code', 'ul', 'ol', 'table', 'thead', 'tbody', 'th', 'td', 'pre', 'aside']) {
    assert.match(html, new RegExp(`<${element}[ >]`));
  }
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /&lt;tag&gt;/);
  assert.deepEqual([...headingAnchors(blocks).values()], ['title', 'section', 'section-1', 'detail']);
  const missing = renderToStaticMarkup(<DocumentBody document={{id: 'missing', title: 'Missing', links: {}}} select={() => {}} />);
  assert.match(missing, /role="status"/);
});
