import React from 'react';
import {Text} from 'ink';
import {TextInput} from '@inkjs/ui';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

// A single labelled text field row. While selected and editable it hosts an @inkjs/ui
// TextInput seeded with defaultValue; otherwise it shows displayValue. Remount the
// component through its React key to reset the editor's internal value.
export function TextField({
  label,
  required = false,
  selected,
  editable = true,
  inputActive,
  defaultValue,
  displayValue,
  placeholder = 'Type or paste',
  preview,
  onChange,
}: {
  label: string;
  required?: boolean;
  selected: boolean;
  editable?: boolean;
  inputActive: boolean;
  defaultValue: string;
  displayValue: string;
  placeholder?: string;
  preview?: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <Text color={selected ? 'cyan' : undefined} wrap="truncate">
        {selected ? '› ' : '  '}
        <Text wrap="truncate">
          {sanitizeTerminalText(label)}
          {required ? '*' : ''}:{' '}
        </Text>
        <Text color={selected ? undefined : mutedColor} wrap="truncate">
          {selected && editable ? (
            <TextInput
              isDisabled={!inputActive}
              defaultValue={defaultValue}
              placeholder={placeholder}
              onChange={onChange}
            />
          ) : (
            sanitizeTerminalText(displayValue)
          )}
        </Text>
      </Text>
      {preview ? <Text color={mutedColor}>{'  '}{sanitizeTerminalText(preview)}</Text> : null}
    </>
  );
}
