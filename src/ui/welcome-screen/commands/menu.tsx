import React from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text} from 'ink';
import {groupCommands, type CommandDefinition} from './definitions.js';
import {sanitizeTerminalText} from '../../sanitize.js';
import {mutedColor} from '../../theme.js';
import {Section} from '../../components/section.js';

type MessageVariant = 'info' | 'success' | 'error' | 'warning';

export function CommandMenu<Id extends string>({
  commands,
  selectedId,
  message,
  messageVariant = 'warning',
}: {
  commands: readonly CommandDefinition<Id>[];
  selectedId: Id;
  message?: string;
  messageVariant?: MessageVariant;
}): React.JSX.Element {
  const grouped = groupCommands(commands);
  const renderCommand = (command: CommandDefinition<Id>): React.JSX.Element => {
    const selected = command.id === selectedId;
    return (
      <Text key={command.id} color={selected ? 'cyan' : mutedColor}>
        {selected ? '›' : ' '} {command.label}{command.description ? ` — ${command.description}` : ''}
      </Text>
    );
  };

  return (
    <Section title="Commands">
      {grouped.primary.map(renderCommand)}
      {grouped.secondary.length > 0 ? (
        <Section title="Other commands">
          {grouped.secondary.map(renderCommand)}
        </Section>
      ) : null}
      <Text color={mutedColor}>↑/↓ — Select · Enter — Open</Text>
      {message ? (
        <Box marginTop={1}>
          <Alert variant={messageVariant}>{sanitizeTerminalText(message)}</Alert>
        </Box>
      ) : null}
    </Section>
  );
}
