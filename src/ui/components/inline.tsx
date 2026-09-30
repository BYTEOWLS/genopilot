import React from 'react';
import {Text} from 'ink';
import type {Inline} from '../../docs/markdown.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {codeColor} from '../theme.js';

/** Inline Markdown spans as nested Ink text: code colored, bold, italic, and links underlined. */
export function InlineSpans({spans}: {spans: readonly Inline[]}): React.JSX.Element {
  return (
    <>
      {spans.map((span, index) => {
        const text = sanitizeTerminalText(span.text);
        switch (span.kind) {
          case 'code':
            return <Text key={index} color={codeColor}>{text}</Text>;
          case 'bold':
            return <Text key={index} bold>{text}</Text>;
          case 'italic':
            return <Text key={index} italic>{text}</Text>;
          case 'link':
            return <Text key={index} underline>{text}</Text>;
          default:
            return <React.Fragment key={index}>{text}</React.Fragment>;
        }
      })}
    </>
  );
}
