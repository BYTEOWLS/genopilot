import React from 'react';
import {Box, Text} from 'ink';
import {ProgressBar} from '@inkjs/ui';
import type {IsolateProgress} from '../../workflows/isolate-progress.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

const stateMarkers: Record<IsolateProgress['state'], {marker: string; color?: string}> = {
  pending: {marker: '·'},
  running: {marker: '●', color: 'cyan'},
  completed: {marker: '✔', color: 'green'},
  failed: {marker: '✖', color: 'red'},
};

// Running and failed isolates stay visible when the list is cut to the terminal's height.
const visibilityOrder: Record<IsolateProgress['state'], number> = {failed: 0, running: 1, pending: 2, completed: 3};

/** The lines the list takes for `count` isolates when at most `maximumRows` rows fit. */
export function isolateProgressHeight(count: number, maximumRows: number): number {
  if (count === 0) {
    return 0;
  }
  // A blank line and the heading, then the rows, then a line naming the hidden ones.
  return 2 + Math.min(count, maximumRows) + (count > maximumRows ? 1 : 0);
}

function detail(isolate: IsolateProgress): string {
  switch (isolate.state) {
    case 'running':
      return `running ${isolate.currentRule?.replaceAll('_', ' ') ?? ''}`.trimEnd();
    case 'completed':
      return isolate.done < isolate.total ? `done, ${String(isolate.total - isolate.done)} steps reused` : 'done';
    default:
      return isolate.state;
  }
}

/**
 * One row per isolate with a progress bar of its finished jobs. States are spelled out and
 * marked with symbols, so the list reads the same without color.
 */
export function IsolateProgressList({
  isolates,
  maximumRows,
  width,
}: {
  isolates: readonly IsolateProgress[];
  maximumRows: number;
  width: number;
}): React.JSX.Element | null {
  if (isolates.length === 0) {
    return null;
  }
  const counts = {completed: 0, running: 0, failed: 0, pending: 0};
  for (const isolate of isolates) {
    counts[isolate.state] += 1;
  }
  const shown = isolates.length <= maximumRows
    ? isolates
    : [...isolates]
      .map((isolate, index) => ({isolate, index}))
      .sort((a, b) => visibilityOrder[a.isolate.state] - visibilityOrder[b.isolate.state] || a.index - b.index)
      .slice(0, maximumRows)
      .sort((a, b) => a.index - b.index)
      .map(({isolate}) => isolate);
  const labelWidth = Math.min(24, Math.max(...shown.map(isolate => isolate.label.length)));
  const barWidth = Math.max(10, Math.min(30, width - labelWidth - 34));
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>
        Isolates{' '}
        <Text bold={false} color={mutedColor}>
          {String(counts.completed)} done · {String(counts.running)} running · {String(counts.failed)} failed ·{' '}
          {String(counts.pending)} pending
        </Text>
      </Text>
      {shown.map(isolate => {
        const {marker, color} = stateMarkers[isolate.state];
        const label = sanitizeTerminalText(isolate.label);
        const value = isolate.state === 'completed' ? 100 : (isolate.done / Math.max(1, isolate.total)) * 100;
        return (
          <Box key={isolate.id}>
            <Text color={isolate.state === 'pending' ? mutedColor : color} wrap="truncate">
              {marker} {label.length > labelWidth ? `${label.slice(0, labelWidth - 1)}…` : label.padEnd(labelWidth)}{' '}
            </Text>
            <Box width={barWidth} flexShrink={0}>
              <ProgressBar value={value} />
            </Box>
            <Text wrap="truncate">
              {' '}{String(isolate.done)}/{String(isolate.total)} {detail(isolate)}
            </Text>
          </Box>
        );
      })}
      {isolates.length > shown.length ? (
        <Text color={mutedColor}>… {String(isolates.length - shown.length)} more isolates</Text>
      ) : null}
    </Box>
  );
}
