import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToString} from 'ink';
import {parseMarkdown} from '../../src/docs/markdown.js';
import {Markdown} from '../../src/ui/components/markdown.js';

const source = [
  '# Title',
  '',
  'A paragraph with `code` and **bold** words that is long enough to wrap in a narrow terminal.',
  '',
  '- first item',
  '- second item',
  '',
  '1. step',
  '',
  '| Item | Meaning |',
  '|---|---|',
  '| `value` | An explanation that is long enough to wrap onto more lines at forty columns. |',
  '',
  '```',
  'command --flag',
  '```',
  '',
  '> [!NOTE]',
  '> A note.',
].join('\n');

function draw(columns: number): string {
  return renderToString(<Markdown blocks={parseMarkdown(source)} />, {columns});
}

test('renders every block readable without colour', () => {
  // The test setup disables colour, so only structure cues remain.
  const output = draw(100);
  assert.match(output, /Title/);
  assert.match(output, /• first item/);
  assert.match(output, /1\. step/);
  assert.match(output, /value\s+An explanation/);
  assert.match(output, /command --flag/);
  assert.match(output, /A note\./);
  assert.doesNotMatch(output, /`|\*\*|\|---/, 'markup characters are not shown');
});

test('wraps within narrow terminals and keeps table continuations aligned', () => {
  const output = draw(40);
  const lines = output.split('\n');
  assert.ok(lines.every(line => line.length <= 40), 'no line exceeds the terminal width');
  const row = lines.findIndex(line => line.startsWith('value'));
  const meaning = lines[row]?.indexOf('An explanation') ?? -1;
  assert.ok(meaning > 0);
  assert.ok(lines[row + 1]?.slice(0, meaning).trim() === '', 'the wrapped cell stays in its column');
});

test('adapts to a resized width', () => {
  assert.ok(draw(40).split('\n').length > draw(120).split('\n').length);
});
