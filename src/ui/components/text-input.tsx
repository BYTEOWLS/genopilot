import React, {useRef, useState} from 'react';
import {Text, useInput, type Key} from 'ink';

export type TextInputState = {value: string; cursor: number};

type EditKey = Pick<Key, 'leftArrow' | 'rightArrow' | 'home' | 'end' | 'backspace' | 'delete' | 'ctrl' | 'meta'> & {
  super?: boolean;
};

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** Start of the word before `cursor`, skipping separators first, as readline's Meta+B does. */
function previousWordStart(value: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && !isWordCharacter(value[index - 1])) {
    index -= 1;
  }
  while (index > 0 && isWordCharacter(value[index - 1])) {
    index -= 1;
  }
  return index;
}

/** End of the word after `cursor`, skipping separators first, as readline's Meta+F does. */
function nextWordEnd(value: string, cursor: number): number {
  let index = cursor;
  while (index < value.length && !isWordCharacter(value[index])) {
    index += 1;
  }
  while (index < value.length && isWordCharacter(value[index])) {
    index += 1;
  }
  return index;
}

/**
 * Applies one keypress to a single-line text value. Supports character and word movement, line
 * start and end (Home/End, Ctrl+A/Ctrl+E, and Cmd+←/→ where the terminal reports them), deleting
 * before (Backspace) and at (Delete) the cursor, and deleting the previous word (Option+Backspace).
 * Inserted text loses control characters such as line breaks. Returns undefined for keys the field
 * does not handle, such as Return or other Ctrl shortcuts.
 */
export function applyTextInputKey(state: TextInputState, input: string, key: EditKey): TextInputState | undefined {
  const {value, cursor} = state;
  const lineStart = key.home || (key.ctrl && input === 'a') || (key.super === true && key.leftArrow);
  const lineEnd = key.end || (key.ctrl && input === 'e') || (key.super === true && key.rightArrow);
  if (lineStart) {
    return {value, cursor: 0};
  }
  if (lineEnd) {
    return {value, cursor: value.length};
  }
  // Option+←/→ arrives either as a modified arrow or, with Option as Meta, as Meta+B/Meta+F.
  if ((key.meta && key.leftArrow) || (key.meta && input === 'b' && !key.ctrl)) {
    return {value, cursor: previousWordStart(value, cursor)};
  }
  if ((key.meta && key.rightArrow) || (key.meta && input === 'f' && !key.ctrl)) {
    return {value, cursor: nextWordEnd(value, cursor)};
  }
  if (key.leftArrow) {
    return {value, cursor: Math.max(0, cursor - 1)};
  }
  if (key.rightArrow) {
    return {value, cursor: Math.min(value.length, cursor + 1)};
  }
  if (key.backspace) {
    const start = key.meta ? previousWordStart(value, cursor) : Math.max(0, cursor - 1);
    return {value: value.slice(0, start) + value.slice(cursor), cursor: start};
  }
  if (key.delete) {
    return {value: value.slice(0, cursor) + value.slice(cursor + 1), cursor};
  }
  // A single-line field keeps no line breaks, tabs, or other control characters, e.g. from a path
  // pasted together with its trailing newline.
  const text = input.replace(/[\u0000-\u001f\u007f]/g, '');
  if (key.ctrl || key.meta || text.length === 0) {
    return undefined;
  }
  return {value: value.slice(0, cursor) + text + value.slice(cursor), cursor: cursor + text.length};
}

/**
 * An uncontrolled single-line text input seeded from `defaultValue`; remount it through its React
 * key to reset the value. `onChange` is called once per edit that changes the value, and
 * `onSubmit` on Return. With `mask`, every character is displayed as that character.
 */
export function TextInput({
  defaultValue = '',
  placeholder = '',
  isDisabled = false,
  mask,
  onChange,
  onSubmit,
}: {
  defaultValue?: string;
  placeholder?: string;
  isDisabled?: boolean;
  mask?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}): React.JSX.Element {
  const [state, setState] = useState<TextInputState>({value: defaultValue, cursor: defaultValue.length});
  // Keypresses can arrive faster than renders, so edits apply to the latest state, not a render's.
  const latest = useRef(state);

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit?.(latest.current.value);
        return;
      }
      if (key.upArrow || key.downArrow || key.tab || key.escape || key.pageUp || key.pageDown) {
        return;
      }
      const next = applyTextInputKey(latest.current, input, key);
      if (next === undefined) {
        return;
      }
      const changed = next.value !== latest.current.value;
      latest.current = next;
      setState(next);
      if (changed) {
        onChange?.(next.value);
      }
    },
    {isActive: !isDisabled},
  );

  if (state.value.length === 0) {
    if (isDisabled) {
      return <Text dimColor>{placeholder}</Text>;
    }
    return placeholder.length > 0 ? (
      <Text><Text inverse>{placeholder[0]}</Text><Text dimColor>{placeholder.slice(1)}</Text></Text>
    ) : (
      <Text inverse> </Text>
    );
  }
  const shown = mask === undefined ? state.value : mask.repeat(state.value.length);
  if (isDisabled) {
    return <Text>{shown}</Text>;
  }
  return (
    <Text>
      {shown.slice(0, state.cursor)}
      <Text inverse>{shown[state.cursor] ?? ' '}</Text>
      {shown.slice(state.cursor + 1)}
    </Text>
  );
}
