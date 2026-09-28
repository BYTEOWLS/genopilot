import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';

/** Widest a leading column may grow, so the last column keeps room to wrap. */
const maximumLeadingColumnWidth = 30;

/**
 * A table with a bold, underlined header. Leading columns are as wide as their longest cell, up to
 * a limit; the last column takes the remaining width and wraps, keeping its lines aligned.
 *
 * With `selectedRow`, the rows become a selectable list: every row is one line, truncated instead of
 * wrapped, and the selected one carries the `›` marker and bold text, so it is visible without color.
 */
export function Table({
  header,
  rows,
  selectedRow,
}: {
  header: readonly string[];
  rows: readonly (readonly string[])[];
  selectedRow?: number;
}): React.JSX.Element {
  const selectable = selectedRow !== undefined;
  const widths = header.slice(0, -1).map((title, column) =>
    Math.min(
      maximumLeadingColumnWidth,
      Math.max(title.length, ...rows.map(row => (row[column] ?? '').length)) + 2,
    ));
  const renderRow = (cells: readonly string[], bold: boolean, marker = ''): React.JSX.Element[] => header.map((_title, column) => {
    const cell = `${column === 0 && selectable ? marker : ''}${sanitizeTerminalText(cells[column] ?? '')}`;
    const text = <Text bold={bold} wrap={selectable ? 'truncate-end' : 'wrap'}>{cell}</Text>;
    const width = widths[column];
    return width === undefined ? (
      <Box key={column} flexGrow={1} flexShrink={1}>{text}</Box>
    ) : (
      <Box key={column} width={width + (column === 0 && selectable ? 2 : 0)} flexShrink={0} paddingRight={2}>{text}</Box>
    );
  });
  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false}>
        {renderRow(header, true, '  ')}
      </Box>
      {rows.map((row, index) => (
        <Box key={index}>{renderRow(row, index === selectedRow, index === selectedRow ? '› ' : '  ')}</Box>
      ))}
    </Box>
  );
}
