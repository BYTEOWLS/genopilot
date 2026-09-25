import React from 'react';
import {Box, Text, useInput} from 'ink';
import {mutedColor} from '../theme.js';

export type TabDefinition<Id extends string> = {id: Id; label: string};

/** Returns the neighbouring tab ID, wrapping around; labels stay presentation-only. */
export function adjacentTabId<Id extends string>(
  tabs: readonly TabDefinition<Id>[],
  activeId: Id,
  offset: -1 | 1,
): Id {
  const index = Math.max(0, tabs.findIndex(tab => tab.id === activeId));
  return tabs[(index + offset + tabs.length) % tabs.length]?.id ?? activeId;
}

/**
 * A row of tabs that switches with Tab/Shift+Tab and, like the file browser moves between
 * folders, with ←/→. The active tab is bracketed as well as highlighted, so it stays recognizable
 * without color, and the row wraps on a narrow terminal.
 */
export function TabBar<Id extends string>({
  tabs,
  activeId,
  onChange,
  inputActive,
  arrowKeys = true,
}: {
  tabs: readonly TabDefinition<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
  /** False while an open form or running edit owns the keyboard. */
  inputActive: boolean;
  /** False while a focused text field needs ←/→ for its cursor; Tab still switches. */
  arrowKeys?: boolean;
}): React.JSX.Element {
  useInput(
    (_input, key) => {
      const modified = key.ctrl || key.meta || key.super === true;
      if (key.tab) {
        onChange(adjacentTabId(tabs, activeId, key.shift ? -1 : 1));
      } else if (arrowKeys && !modified && (key.leftArrow || key.rightArrow)) {
        onChange(adjacentTabId(tabs, activeId, key.leftArrow ? -1 : 1));
      }
    },
    {isActive: inputActive},
  );

  return (
    <Box flexWrap="wrap" columnGap={1}>
      {tabs.map(tab => {
        const active = tab.id === activeId;
        return (
          <Text key={tab.id} bold={active} color={active ? 'cyan' : mutedColor}>
            {active ? `[ ${tab.label} ]` : `  ${tab.label}  `}
          </Text>
        );
      })}
    </Box>
  );
}
