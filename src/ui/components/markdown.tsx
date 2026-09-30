import React from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {AlertVariant, Block} from '../../docs/markdown.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {headingColor} from '../theme.js';
import {InlineSpans} from './inline.js';
import {Table} from './table.js';

const alertVariants: Record<AlertVariant, 'info' | 'success' | 'warning'> = {
  note: 'info',
  tip: 'success',
  warning: 'warning',
};

/** Named like GitHub's alerts, so the kind is readable without colour. */
const alertTitles: Record<AlertVariant, string> = {note: 'Note', tip: 'Tip', warning: 'Warning'};

function BlockView({block}: {block: Block}): React.JSX.Element {
  switch (block.kind) {
    case 'heading':
      // Top-level headings are also underlined, so levels differ without colour.
      return (
        <Text bold underline={block.level === 1} color={block.level < 3 ? headingColor : undefined} wrap="wrap">
          <InlineSpans spans={block.content} />
        </Text>
      );
    case 'paragraph':
      return <Text wrap="wrap"><InlineSpans spans={block.content} /></Text>;
    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, index) => {
            const marker = block.ordered ? `${String(index + 1)}.` : '•';
            return (
              <Box key={index}>
                <Box width={marker.length + 1} flexShrink={0}><Text>{marker}</Text></Box>
                <Box flexGrow={1} flexShrink={1}><Text wrap="wrap"><InlineSpans spans={item} /></Text></Box>
              </Box>
            );
          })}
        </Box>
      );
    case 'table':
      return <Table header={block.header} rows={block.rows} />;
    case 'code':
      return (
        <Box borderStyle="round" paddingX={1}>
          <Text wrap="wrap">{sanitizeTerminalText(block.text)}</Text>
        </Box>
      );
    case 'alert':
      return (
        // The alert wraps its message in one text, so paragraphs are separated by a blank line.
        <Alert variant={alertVariants[block.variant]} title={alertTitles[block.variant]}>
          {block.paragraphs.map((paragraph, index) => (
            <React.Fragment key={index}>
              {index > 0 ? '\n\n' : ''}
              <InlineSpans spans={paragraph} />
            </React.Fragment>
          ))}
        </Alert>
      );
  }
}

/** Renders parsed Markdown blocks, one blank line apart, wrapping to the terminal width. */
export function Markdown({blocks}: {blocks: readonly Block[]}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <Box key={index} marginTop={index === 0 ? 0 : 1} flexDirection="column" flexShrink={0}>
          <BlockView block={block} />
        </Box>
      ))}
    </Box>
  );
}
