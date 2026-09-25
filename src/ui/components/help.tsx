import React, {useLayoutEffect, useRef, useState} from 'react';
import {Box, measureElement, Text, useInput, useWindowSize, type DOMElement} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {Table} from './table.js';

export type HelpValue = {value: string; explanation?: string};

export type HelpEntry = {
  /** Same stable identifier as the item this entry explains. */
  id: string;
  label: string;
  /** One-line definition persisted with the run, when the workflow recorded one. */
  definition?: string;
  explanation?: string;
  /** A sample line as the screen shows it, framed so it reads as an excerpt. */
  example?: string;
  /** A table, e.g. explaining each part of `example`. */
  table?: {header: readonly string[]; rows: readonly (readonly string[])[]};
  values?: readonly HelpValue[];
};

export type HelpSection = {id: string; title: string; entries: readonly HelpEntry[]};

function HelpEntryView({entry}: {entry: HelpEntry}): React.JSX.Element {
  const explained = entry.definition !== undefined || entry.explanation !== undefined || entry.table !== undefined;
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text bold>{entry.label}</Text>
      {entry.definition !== undefined ? (
        <Text wrap="wrap">
          <Text color={mutedColor}>Recorded definition: </Text>
          {sanitizeTerminalText(entry.definition)}
        </Text>
      ) : null}
      {entry.explanation !== undefined ? <Text wrap="wrap">{entry.explanation}</Text> : null}
      {entry.example !== undefined ? (
        <Box marginTop={1} borderStyle="round" paddingX={1}>
          <Text wrap="wrap">{sanitizeTerminalText(entry.example)}</Text>
        </Box>
      ) : null}
      {entry.table !== undefined ? (
        <Box marginTop={1}>
          <Table header={entry.table.header} rows={entry.table.rows} />
        </Box>
      ) : null}
      {!explained ? <Text color={mutedColor}>No explanation is available for this item.</Text> : null}
      {entry.values?.map(value => (
        <Box key={value.value} marginLeft={2}>
          <Text wrap="wrap">
            <Text bold>{sanitizeTerminalText(value.value)}</Text>
            {' — '}
            {value.explanation ?? (
              <Text color={mutedColor}>Observed in this run; this application version has no explanation for it.</Text>
            )}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** Scroll content of a help page; the hosting screen owns scrolling and input. */
export function HelpContent({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: readonly HelpSection[];
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text wrap="wrap" color={mutedColor}>{intro}</Text>
      {sections.map(section => (
        <Box key={section.id} marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold underline>{section.title}</Text>
          {section.entries.map(entry => <HelpEntryView key={entry.id} entry={entry} />)}
        </Box>
      ))}
    </Box>
  );
}

/**
 * A full-screen, scrollable help page for screens that have no scrolling of their own. Esc or `?`
 * closes it, returning to the screen that opened it.
 */
export function HelpPage({
  title,
  intro,
  sections,
  onClose,
  inputActive,
}: {
  title: string;
  intro: string;
  sections: readonly HelpSection[];
  onClose: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const {columns, rows} = useWindowSize();
  const contentRef = useRef<DOMElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const visibleRows = Math.max(5, rows - 3);
  const maximumScrollOffset = Math.max(0, contentHeight - visibleRows);
  const effectiveScrollOffset = Math.min(scrollOffset, maximumScrollOffset);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setContentHeight(measureElement(contentRef.current).height);
    }
  }, [columns, rows, sections]);

  const scrollBy = (delta: number): void => {
    setScrollOffset(current => Math.max(0, Math.min(maximumScrollOffset, Math.min(current, maximumScrollOffset) + delta)));
  };

  useInput(
    (input, key) => {
      if (key.escape || input === '?') {
        onClose();
      } else if (key.upArrow) {
        scrollBy(-1);
      } else if (key.downArrow) {
        scrollBy(1);
      } else if (key.pageUp) {
        scrollBy(-visibleRows);
      } else if (key.pageDown) {
        scrollBy(visibleRows);
      }
    },
    {isActive: inputActive},
  );

  return (
    <Box flexDirection="column">
      <Box
        height={contentHeight === 0 ? undefined : visibleRows}
        overflow={contentHeight === 0 ? 'visible' : 'hidden'}
        flexDirection="column"
      >
        <Box ref={contentRef} marginTop={-effectiveScrollOffset} flexDirection="column" flexShrink={0}>
          <HelpContent title={title} intro={intro} sections={sections} />
        </Box>
      </Box>
      <Text color={mutedColor}>
        {maximumScrollOffset > 0 ? '↑/↓ — Scroll · PageUp/PageDown (or fn + ↑/↓) — Page · ' : ''}Esc or ? — Close help
      </Text>
    </Box>
  );
}
