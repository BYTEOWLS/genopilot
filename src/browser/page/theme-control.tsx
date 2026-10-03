import React from 'react';
import {ActionIcon, useMantineColorScheme} from '@mantine/core';

const modes = {auto: {label: 'Automatic', next: 'light'}, light: {label: 'Light', next: 'dark'}, dark: {label: 'Dark', next: 'auto'}} as const;

/** Cycle through the preference, not just the currently resolved system color scheme. */
export function ThemeControl(): React.JSX.Element {
  const {colorScheme, setColorScheme} = useMantineColorScheme();
  const mode = modes[colorScheme];
  const description = `Theme: ${mode.label}. Switch to ${modes[mode.next].label}.`;
  return <ActionIcon variant="default" size={36} data-control="theme" data-theme-mode={colorScheme} aria-label={description} title={description} onClick={() => setColorScheme(mode.next)}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {colorScheme === 'auto' ? <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8" /></> : colorScheme === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></> : <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />}
    </svg>
  </ActionIcon>;
}
