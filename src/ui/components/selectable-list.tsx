import React from 'react';
import {Box, Text, useInput} from 'ink';
import {mutedColor} from '../theme.js';
import {usePageShortcuts} from './page.js';
import {Table, type TableCell} from './table.js';

type ListKey = {upArrow: boolean; downArrow: boolean; pageUp: boolean; pageDown: boolean};

/** Lines a selectable table takes besides its rows: the header and its rule. */
export const selectableTableHeaderLines = 2;

/**
 * The selection after a list key, or undefined when the key is not one. ↑/↓ move one item and
 * wrap around; PageUp/PageDown move a page and stop at the first or last item, and wrap from there.
 */
export function stepSelection(key: ListKey, {index, count, pageSize}: {index: number; count: number; pageSize: number}): number | undefined {
  if (count === 0) {
    return undefined;
  }
  const current = Math.max(0, Math.min(index, count - 1));
  if (key.upArrow || key.downArrow) {
    return (current + (key.upArrow ? -1 : 1) + count) % count;
  }
  if (key.pageUp) {
    return current === 0 ? count - 1 : Math.max(0, current - pageSize);
  }
  if (key.pageDown) {
    return current === count - 1 ? 0 : Math.min(count - 1, current + pageSize);
  }
  return undefined;
}

/** Whether a key moves the selection of a list; a screen leaves these keys to an active list. */
export function isListKey(key: ListKey): boolean {
  return key.upArrow || key.downArrow || key.pageUp || key.pageDown;
}

/** The first item shown when `pageSize` items around the selected one fit. */
function windowStart(index: number, count: number, pageSize: number): number {
  return Math.max(0, Math.min(index - Math.floor(pageSize / 2), count - pageSize));
}

type ListProps = {
  count: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Whether the list takes its keys now. */
  active: boolean;
  /** Lines the list may use, including the position line. */
  height: number;
  /** What the position line counts, such as `genes`. */
  noun: string;
};

/**
 * The shared selection, windowing, and shortcuts of a list: the items that fit around the selected
 * one, the keys that move it, and the position line under a list longer than one page.
 */
function useSelectableWindow({count, selectedIndex, onSelect, active, noun}: ListProps, pageSize: number) {
  const index = Math.max(0, Math.min(selectedIndex, count - 1));
  useInput((_input, key) => {
    const next = stepSelection(key, {index, count, pageSize});
    if (next !== undefined && next !== index) {
      onSelect(next);
    }
  }, {isActive: active && count > 0});
  const paged = count > pageSize;
  usePageShortcuts(active && count > 0
    ? ['↑/↓ — Select', paged ? 'PageUp/PageDown (or fn + ↑/↓) — Page' : '']
    : []);
  const first = windowStart(index, count, pageSize);
  const last = Math.min(count, first + pageSize);
  const position = paged
    ? <Text color={mutedColor}>{'  '}{noun} {String(first + 1)}–{String(last)} of {String(count)}</Text>
    : null;
  return {index, first, last, position};
}

/**
 * A selectable list of one-line items. It owns the keys that move the selection (↑/↓ wrap around,
 * PageUp/PageDown move a page), shows the items that fit `height`, and adds its shortcuts to the
 * page's shortcut line. The caller keeps the selection and draws each item.
 */
export function SelectableList({
  renderItem,
  ...props
}: ListProps & {
  /** One line for an item; `selected` items should carry the `›` marker. */
  renderItem: (index: number, selected: boolean) => React.ReactNode;
}): React.JSX.Element | null {
  const pageSize = Math.max(1, props.height - 1);
  const {index, first, last, position} = useSelectableWindow(props, pageSize);
  if (props.count === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      {Array.from({length: last - first}, (_, offset) => (
        <React.Fragment key={first + offset}>{renderItem(first + offset, first + offset === index)}</React.Fragment>
      ))}
      {position}
    </Box>
  );
}

/**
 * A selectable list drawn as a `Table`, with the behavior of `SelectableList`. Columns are sized
 * from all rows, so they keep their width while paging.
 */
export function SelectableTable({
  header,
  rows,
  align,
  ...props
}: Omit<ListProps, 'count'> & {
  header: readonly TableCell[];
  rows: readonly (readonly TableCell[])[];
  align?: readonly ('left' | 'right')[];
}): React.JSX.Element | null {
  const pageSize = Math.max(1, props.height - selectableTableHeaderLines - 1);
  const {index, first, last, position} = useSelectableWindow({...props, count: rows.length}, pageSize);
  if (rows.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      <Table header={header} rows={rows.slice(first, last)} widthRows={rows} selectedRow={index - first} {...(align ? {align} : {})} />
      {position}
    </Box>
  );
}
