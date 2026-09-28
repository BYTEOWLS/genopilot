import React from 'react';
import {Box, Text} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {TextInput} from './text-input.js';

export type ParameterRow = {
  /** Stable identifier, independent of the displayed label. */
  id: string;
  label: string;
  value: string;
  /** Shown muted, e.g. for a fact NCBI did not report or an empty optional field. */
  muted?: boolean;
  /** Present for a row the researcher can edit; it becomes a text field while selected. */
  edit?: {defaultValue: string; placeholder?: string; onChange: (value: string) => void};
  /** A row the form changes with its own keys, such as a choice; it is selectable but never a text field. */
  choice?: boolean;
};

/** The label column's width for these rows, including the selection marker and a gap. */
export function parameterLabelWidth(rows: readonly {label: string}[]): number {
  return Math.max(...rows.map(row => row.label.length)) + 4;
}

/**
 * Parameters as one aligned list of labels and values. Editable rows show the selection marker and
 * become a text field while selected; the form owns the selection and all other keys.
 */
export function ParameterList({
  rows,
  selectedId,
  inputActive,
  labelWidth: sharedLabelWidth,
}: {
  rows: readonly ParameterRow[];
  selectedId?: string;
  inputActive: boolean;
  /** A width shared with other lists, so several lists on one page stay aligned. */
  labelWidth?: number;
}): React.JSX.Element {
  const labelWidth = sharedLabelWidth ?? parameterLabelWidth(rows);
  return (
    <Box flexDirection="column">
      {rows.map(row => {
        const editable = row.edit !== undefined || row.choice === true;
        const selected = row.id === selectedId && editable;
        return (
          <Box key={row.id}>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={selected ? 'cyan' : undefined} bold={editable}>
                {selected ? '› ' : '  '}{sanitizeTerminalText(row.label)}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {selected && row.edit ? (
                <TextInput
                  isDisabled={!inputActive}
                  defaultValue={row.edit.defaultValue}
                  placeholder={row.edit.placeholder ?? 'Type or paste'}
                  onChange={row.edit.onChange}
                />
              ) : (
                <Text color={row.muted ? mutedColor : undefined} wrap="wrap">{sanitizeTerminalText(row.value)}</Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
