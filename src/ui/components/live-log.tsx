import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

/**
 * Shared bounded live-log presentation for setup and workflow processes.
 *
 * Given `visibleLines`, the log becomes a scrollable window over the retained output:
 * `scrollOffset` counts lines back from the newest, so 0 follows the end of the output and a
 * larger value holds an earlier position while new lines keep arriving.
 */
export function LiveLog({
  title,
  lines,
  emptyMessage,
  visibleLines,
  scrollOffset = 0,
  footer,
}: {
  title: string;
  lines: readonly string[];
  emptyMessage?: string;
  visibleLines?: number;
  scrollOffset?: number;
  footer?: string;
}): React.JSX.Element {
  const windowSize = Math.max(1, visibleLines ?? lines.length);
  const end = Math.max(0, lines.length - scrollOffset);
  const start = Math.max(0, end - windowSize);
  const visible = visibleLines === undefined ? lines : lines.slice(start, end);
  const above = start;
  const below = lines.length - end;

  return (
    <Box
      borderBottom
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop
      flexDirection="column"
      marginTop={1}
      paddingX={1}
    >
      <Text bold color={mutedColor}>{sanitizeTerminalText(title)}</Text>
      {lines.length === 0 && emptyMessage ? (
        <Text color={mutedColor}>{sanitizeTerminalText(emptyMessage)}</Text>
      ) : null}
      {above > 0 ? <Text color={mutedColor}>↑ {above} earlier {above === 1 ? 'line' : 'lines'}</Text> : null}
      {visible.map((line, index) => (
        <Text key={`${String(start + index)}-${line}`} color={mutedColor} wrap="truncate-end">
          {sanitizeTerminalText(line)}
        </Text>
      ))}
      {below > 0 ? <Text color={mutedColor}>↓ {below} newer {below === 1 ? 'line' : 'lines'}</Text> : null}
      {footer ? <Text color={mutedColor}>{sanitizeTerminalText(footer)}</Text> : null}
    </Box>
  );
}
