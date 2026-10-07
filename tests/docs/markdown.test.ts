import assert from 'node:assert/strict';
import test from 'node:test';
import {documentTitle, inlineText, markdownSection, parseInline, parseMarkdown, plainText, unsupportedMarkdown} from '../../src/docs/markdown.js';

test('parses every supported block', () => {
  const blocks = parseMarkdown([
    '# Title',
    '',
    'A paragraph',
    'continued on a second line.',
    '',
    '## Section',
    '',
    '- first',
    '- second',
    '',
    '1. one',
    '2. two',
    '',
    '| Item | Meaning |',
    '|---|---|',
    '| `a` | first \\| with a pipe |',
    '',
    '```bash',
    'snakemake --cores 1',
    '```',
    '',
    '> [!WARNING]',
    '> Watch out.',
    '>',
    '> Second paragraph.',
    '',
    '### Detail',
  ].join('\n'));

  assert.deepEqual(blocks.map(block => block.kind), [
    'heading', 'paragraph', 'heading', 'list', 'list', 'table', 'code', 'alert', 'heading',
  ]);
  assert.equal(documentTitle(blocks), 'Title');
  const paragraph = blocks[1];
  assert.equal(paragraph?.kind === 'paragraph' && inlineText(paragraph.content), 'A paragraph continued on a second line.');
  const bullets = blocks[3];
  assert.ok(bullets?.kind === 'list' && !bullets.ordered && bullets.items.length === 2);
  const ordered = blocks[4];
  assert.ok(ordered?.kind === 'list' && ordered.ordered);
  const table = blocks[5];
  assert.ok(table?.kind === 'table');
  assert.deepEqual(table.header.map(inlineText), ['Item', 'Meaning']);
  assert.deepEqual(table.rows[0]?.map(inlineText), ['a', 'first | with a pipe']);
  assert.equal(table.rows[0]?.[0]?.[0]?.kind, 'code');
  const code = blocks[6];
  assert.equal(code?.kind === 'code' && code.text, 'snakemake --cores 1');
  const alert = blocks[7];
  assert.ok(alert?.kind === 'alert');
  assert.equal(alert.variant, 'warning');
  assert.deepEqual(alert.paragraphs.map(inlineText), ['Watch out.', 'Second paragraph.']);
  const detail = blocks[8];
  assert.ok(detail?.kind === 'heading' && detail.level === 3);
});

test('parses inline code, bold, italic, and links shown as their text', () => {
  assert.deepEqual(parseInline('See `x`, **bold**, *italic*, and [the README](README.md).'), [
    {kind: 'text', text: 'See '},
    {kind: 'code', text: 'x'},
    {kind: 'text', text: ', '},
    {kind: 'bold', text: 'bold'},
    {kind: 'text', text: ', '},
    {kind: 'italic', text: 'italic'},
    {kind: 'text', text: ', and '},
    {kind: 'link', text: 'the README', href: 'README.md'},
    {kind: 'text', text: '.'},
  ]);
  // Brackets without a target stay text, such as citation numbers.
  assert.equal(inlineText(parseInline('Cited [5, 6].')), 'Cited [5, 6].');
  assert.deepEqual(parseInline('2 * 3 * 4').map(span => span.kind), ['text']);
});

test('retains targets for code-styled, external, relative, and anchor links', () => {
  assert.deepEqual(parseInline('[`file`](../README.md#tools)'), [{kind: 'code', text: 'file', href: '../README.md#tools'}]);
  for (const href of ['https://example.org/a', 'help.md', '#section']) {
    assert.deepEqual(parseInline(`[label](${href})`), [{kind: 'link', text: 'label', href}]);
  }
});

test('keeps unsupported syntax as plain text and reports it', () => {
  const source = [
    '#### Deep heading',
    '<b>html</b>',
    '> a quote',
    '- item',
    '  - nested item',
    '![image](a.png)',
    'Text with a footnote[^1].',
    '```',
    '<kept> inside code',
    '```',
  ].join('\n');
  const blocks = parseMarkdown(source);
  const text = blocks.map(block => block.kind === 'paragraph' ? inlineText(block.content) : block.kind).join('\n');
  assert.match(text, /#### Deep heading/);
  assert.match(text, /<b>html<\/b>/);
  assert.match(text, /> a quote/);
  const list = blocks.find(block => block.kind === 'list');
  assert.ok(list?.kind === 'list');
  assert.match(inlineText(list.items[0] ?? []), /nested item/);

  const problems = unsupportedMarkdown(source).join('\n');
  for (const expected of ['heading deeper', 'HTML', 'blockquote', 'nested list', 'image', 'footnote']) {
    assert.match(problems, new RegExp(expected));
  }
  assert.doesNotMatch(problems, /^9:/m, 'code blocks are not checked');
});

test('slices a heading with its nested content, stopping at a peer or parent heading', () => {
  const blocks = parseMarkdown('# A\n\n## B\n\nBody.\n\n### C\n\nDetail.\n\n## D\n\nLast.\n\n# E');
  assert.deepEqual(markdownSection(blocks, 1), blocks.slice(1, 5));
  assert.deepEqual(markdownSection(blocks, 3), blocks.slice(3, 5));
  assert.deepEqual(markdownSection(blocks, 5), blocks.slice(5, 7));
  assert.deepEqual(markdownSection(blocks, 7), blocks.slice(7));
  assert.deepEqual(markdownSection(blocks, 0), blocks.slice(0, 7));
});

test('does not treat missing headings or body blocks as sections', () => {
  const blocks = parseMarkdown('# A\n\nBody.');
  for (const start of [-1, 1, 2]) {
    assert.deepEqual(markdownSection(blocks, start), []);
  }
  assert.deepEqual(markdownSection([], 0), []);
});

test('accepts the documented subset without problems', () => {
  assert.deepEqual(unsupportedMarkdown('# T\n\n`<tag>` in code\n\n> [!NOTE]\n> Fine.\n'), []);
});

test('turns blocks into plain text without Markdown markup', () => {
  const blocks = parseMarkdown([
    '## Methods',
    '',
    'Reads were aligned with **bwa mem** `0.7.19` ([details](README.md)).',
    '',
    '1. First reference.',
    '2. Second reference.',
    '',
    '| Tool | Version |',
    '|---|---|',
    '| fastp | 1.3.7 |',
    '',
    '```bibtex',
    '@article{x,',
    '}',
    '```',
  ].join('\n'));
  assert.equal(plainText(blocks), [
    'Methods',
    'Reads were aligned with bwa mem 0.7.19 (details).',
    '1. First reference.\n2. Second reference.',
    'Tool\tVersion\nfastp\t1.3.7',
    '@article{x,\n}',
  ].join('\n\n'));
});
