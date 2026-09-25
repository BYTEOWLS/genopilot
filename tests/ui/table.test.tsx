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
