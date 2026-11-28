import React from 'react';
import {useInput} from 'ink';
import {ParameterList} from './parameter-list.js';
import {usePageShortcuts} from './page.js';

export type CheckboxRow = {
  id: string;
  label: string;
  checked: boolean;
  description?: string;
  disabled?: boolean;
};

/** Inline form choices. The form owns focus, navigation, validation, and the viewport. */
export function CheckboxGroup({rows, selectedId, inputActive, labelWidth, onChange}: {
  rows: readonly CheckboxRow[];
  selectedId?: string;
  inputActive: boolean;
  labelWidth?: number;
  onChange: (id: string, checked: boolean) => void;
}): React.JSX.Element {
  const selected = rows.find(row => row.id === selectedId);
  const active = inputActive && selected !== undefined && !selected.disabled;
  usePageShortcuts(active ? ['Space/←/→ — Change'] : []);
  useInput((input, key) => {
    if (selected && (input === ' ' || key.leftArrow || key.rightArrow)) {
      onChange(selected.id, !selected.checked);
    }
  }, {isActive: active});
  return <ParameterList rows={rows.map(row => ({
    id: row.id,
    label: row.label,
    value: `${row.checked ? '[x]' : '[ ]'}${row.description ? ` ${row.description}` : ''}`,
    muted: row.disabled,
    choice: true,
  }))} selectedId={selectedId} inputActive={inputActive} labelWidth={labelWidth} />;
}
