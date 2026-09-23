import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

export type HelpValue = {value: string; explanation?: string};

export type HelpEntry = {
  /** Same stable identifier as the result item this entry explains. */
  id: string;
  label: string;
  /** One-line definition persisted with the run, when the workflow recorded one. */
  definition?: string;
  explanation?: string;
  values?: readonly HelpValue[];
};

export type HelpSection = {id: string; title: string; entries: readonly HelpEntry[]};

function HelpEntryView({entry}: {entry: HelpEntry}): React.JSX.Element {
  const explained = entry.definition !== undefined || entry.explanation !== undefined;
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

/** Scroll content of the result help page; the result screen owns scrolling and input. */
export function ResultHelp({sections}: {sections: readonly HelpSection[]}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>Result help</Text>
      <Text wrap="wrap" color={mutedColor}>
        Each entry explains one item of the result page. Recorded definitions were saved with this run by the workflow.
      </Text>
      {sections.map(section => (
        <Box key={section.id} marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold underline>{section.title}</Text>
          {section.entries.map(entry => <HelpEntryView key={entry.id} entry={entry} />)}
        </Box>
      ))}
    </Box>
  );
}
