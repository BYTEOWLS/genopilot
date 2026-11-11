import React, {createContext, useContext} from 'react';
import {Box, Text} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';

const InsideSection = createContext(false);

export type SectionProps = {
  title: string;
  /** Borders are opt-in; nested sections remain borderless unless explicitly requested. */
  border?: boolean;
  marginTop?: number;
  children: React.ReactNode;
};

/** Shared section layout; children own their data, input, and focus behavior. */
export function Section({title, border = false, marginTop = 1, children}: SectionProps): React.JSX.Element {
  const nested = useContext(InsideSection);
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={marginTop} marginLeft={nested ? 2 : 0}
      borderStyle={border ? 'round' : undefined} paddingX={border ? 1 : 0}>
      <Text bold wrap="truncate">{sanitizeTerminalText(title)}</Text>
      <InsideSection.Provider value={true}>{children}</InsideSection.Provider>
    </Box>
  );
}
