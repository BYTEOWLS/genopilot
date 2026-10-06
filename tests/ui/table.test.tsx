import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToString} from 'ink';
import {Table} from '../../src/ui/components/table.js';

test('sizes the leading column to its content and wraps the last column aligned', () => {
  const output = renderToString(
    <Table
      header={['Part', 'Meaning']}
      rows={[
        ['Run 24', 'The run number from the read headers, which identifies one sequencing run.'],
        ['lane 1', 'Lane from the file name.'],
      ]}
    />,
    {columns: 40},
  );
  const lines = output.split('\n');
  const meaningColumn = lines[0]?.indexOf('Meaning') ?? -1;
  // Leading column: widest cell ("Run 24") plus two spaces of padding.
  assert.equal(meaningColumn, 'Run 24'.length + 2);
  const firstRow = lines.findIndex(line => line.startsWith('Run 24'));
  const nextRow = lines.findIndex(line => line.startsWith('lane 1'));
  assert.ok(nextRow - firstRow > 1, 'the long explanation wraps onto several lines');
  // Continuation lines leave the leading column empty.
  assert.ok(lines.slice(firstRow + 1, nextRow).every(line => line.slice(0, meaningColumn).trim() === ''));
});

test('caps a very long leading cell so the last column keeps room', () => {
  const output = renderToString(
    <Table header={['Part', 'Meaning']} rows={[['x'.repeat(60), 'Short.']]} />,
    {columns: 80},
  );
  const meaningColumn = output.split('\n')[0]?.indexOf('Meaning') ?? -1;
  assert.equal(meaningColumn, 30);
});

test('right-aligns the columns it is asked to, for numbers in a column of their own', () => {
  const output = renderToString(
    <Table header={['Group', 'Genes', 'Meaning']} rows={[['exact', '10,091', 'Same.'], ['near', '7', 'Close.']]} align={['left', 'right']} />,
    {columns: 60},
  );
  const lines = output.split('\n');
  const end = (line: string | undefined, text: string): number => (line?.indexOf(text) ?? -1) + text.length;
  const header = lines[0];
  const exact = lines.find(line => line.startsWith('exact'));
  const near = lines.find(line => line.startsWith('near'));
  assert.equal(end(exact, '10,091'), end(near, '7'), 'the numbers end in the same column');
  assert.equal(end(header, 'Genes'), end(exact, '10,091'), 'the header aligns with its column');
  assert.equal(near?.indexOf('Close.'), exact?.indexOf('Same.'), 'the next column still starts in one place');
});
