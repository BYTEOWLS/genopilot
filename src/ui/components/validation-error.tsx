import React from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import {sanitizeTerminalText} from '../sanitize.js';

export function ValidationError({title, problems}: {title: string; problems: string[]}) {
  if (problems.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Alert variant="error">
        <Text color="red">{title}</Text>
        {problems.map(problem => `\n• ${sanitizeTerminalText(problem)}`).join('')}
      </Alert>
    </Box>
  );
}
