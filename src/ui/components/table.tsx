import React from 'react';
import {Box, Text} from 'ink';
import {inlineText, type Inline} from '../../docs/markdown.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {InlineSpans} from './inline.js';

/** A cell: plain text, or Markdown inline spans such as `code` and bold. */
export type TableCell = string | readonly Inline[];

function cellText(cell: TableCell | undefined): string {
  return cell === undefined ? '' : typeof cell === 'string' ? cell : inlineText(cell);
}

/** Widest a leading column may grow, so the last column keeps room to wrap. */
const maximumLeadingColumnWidth = 30;

/** Width the last column claims before the columns share what is left. */
const minimumLastColumnWidth = 30;

/**
 * A table with a bold, underlined header. Leading columns are as wide as their longest cell, up to
 * a limit; the last column takes the remaining width and wraps, keeping its lines aligned. In a
 * narrow terminal all columns shrink and wrap.
 *
 * With `selectedRow`, the rows become a selectable list: every row is one line, truncated instead of
 * wrapped, and the selected one carries the `›` marker and bold text, so it is visible without color.
 */
export function Table({
  header,
  rows,
  selectedRow,
}: {
  header: readonly TableCell[];
  rows: readonly (readonly TableCell[])[];
  selectedRow?: number;
}): React.JSX.Element {
  const selectable = selectedRow !== undefined;
  const widths = header.slice(0, -1).map((title, column) =>
    Math.min(
      maximumLeadingColumnWidth,
      Math.max(cellText(title).length, ...rows.map(row => cellText(row[column]).length)) + 2,
    ));
  // When a wrapping table does not fit, its leading columns give up width in proportion to their
  // size, so the last column keeps room to wrap instead of shrinking to a single character.
  const lastColumn = header.length - 1;
  const lastColumnBasis = Math.min(
    minimumLastColumnWidth,
    Math.max(cellText(header[lastColumn]).length, ...rows.map(row => cellText(row[lastColumn]).length)),
  );
  const renderRow = (cells: readonly TableCell[], bold: boolean, marker = ''): React.JSX.Element[] => header.map((_title, column) => {
    const cell = cells[column] ?? '';
    const text = (
      <Text bold={bold} wrap={selectable ? 'truncate-end' : 'wrap'}>
        {column === 0 && selectable ? marker : ''}
        {typeof cell === 'string' ? sanitizeTerminalText(cell) : <InlineSpans spans={cell} />}
      </Text>
    );
    const width = widths[column];
    return width === undefined ? (
      <Box key={column} flexGrow={1} flexShrink={selectable ? 1 : 0} flexBasis={selectable ? undefined : lastColumnBasis}>{text}</Box>
    ) : (
      // A selectable row is one truncated line, so its leading columns keep their width.
      <Box key={column} flexBasis={width + (column === 0 && selectable ? 2 : 0)} flexShrink={selectable ? 0 : 1} paddingRight={2}>{text}</Box>
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
