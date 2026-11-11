import React, {createContext, useCallback, useContext, useEffect, useId, useState} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import {useHomeSuspensionState} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {ValidationError} from './validation-error.js';
import {useBrowserView} from '../../browser/provider.js';

/** A shortcut hint such as `n — Add`; false or undefined entries are skipped. */
export type Shortcut = string | false | undefined;

export type PageProps = {
  title: string;
  /** Short muted text after the title, such as a count. */
  detail?: string;
  description?: string;
  /** Shown right under the title, before the description, such as a tab bar. */
  header?: React.ReactNode;
  /**
   * Screen-specific shortcuts; components inside the page, such as a selectable list, add theirs
   * first, and Esc and the home shortcut are always appended.
   */
  shortcuts?: readonly Shortcut[];
  /** What Esc does here; false only while nothing may be left, such as a running workflow. */
  back?: string | false;
  children?: React.ReactNode;
};

type RegisterShortcuts = (id: string, shortcuts: readonly string[]) => void;

const PageShortcutsContext = createContext<RegisterShortcuts | undefined>(undefined);

/**
 * Adds shortcuts of a component inside a `Page`, such as a selectable list's keys, to the page's
 * shortcut line, ahead of the screen's own; empty or blank entries add nothing.
 */
export function usePageShortcuts(shortcuts: readonly Shortcut[]): void {
  const register = useContext(PageShortcutsContext);
  const id = useId();
  const shown = shortcuts.filter((shortcut): shortcut is string => typeof shortcut === 'string' && shortcut.length > 0);
  const key = shown.join('\n');
  useEffect(() => {
    register?.(id, shown);
  }, [register, id, key]);
  useEffect(() => () => register?.(id, []), [register, id]);
}

/** The home shortcut as it applies now: typed into a focused field, or waiting for running work. */
function homeShortcut(suspension: ReturnType<typeof useHomeSuspensionState>): string | undefined {
  switch (suspension) {
    case 'typing':
      return undefined;
    case 'busy':
      return 'h — Home, once the current work finishes';
    default:
      return 'h — Home';
  }
}

/**
 * The frame every screen shares: a bold, underlined title with an optional muted detail and
 * description, the screen's content, and one shortcut line that always ends with Esc and Home.
 */
export function Page({
  title,
  detail,
  description,
  header,
  shortcuts = [],
  back = 'Back',
  children,
}: PageProps): React.JSX.Element {
  const suspension = useHomeSuspensionState();
  const browser = useBrowserView();
  const [registered, setRegistered] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  const register = useCallback<RegisterShortcuts>((id, values) => {
    setRegistered(current => {
      if (values.length === 0 && !current.has(id)) {
        return current;
      }
      const next = new Map(current);
      if (values.length === 0) {
        next.delete(id);
      } else {
        next.set(id, values);
      }
      return next;
    });
  }, []);
  const line = [
    ...[...registered.values()].flat(),
    ...shortcuts.filter((shortcut): shortcut is string => typeof shortcut === 'string' && shortcut.length > 0),
    back === false ? undefined : `Esc — ${back}`,
    homeShortcut(suspension),
  ].filter((shortcut): shortcut is string => shortcut !== undefined);
  return (
    <PageShortcutsContext.Provider value={register}>
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text bold underline>{sanitizeTerminalText(title)}</Text>
          {detail ? <Text color={mutedColor}> · {sanitizeTerminalText(detail)}</Text> : null}
        </Text>
        {header ? <Box marginTop={1}>{header}</Box> : null}
        {description ? (
          <Box marginTop={header ? 1 : 0}>
            <Text color={mutedColor} wrap="wrap">{description}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
        {browser?.status ? <Alert variant="error">{sanitizeTerminalText(browser.status)}</Alert> : null}
        <Box marginTop={1}>
          {/* Non-breaking spaces inside each shortcut, so the line only wraps between shortcuts. */}
          <Text color={mutedColor} wrap="wrap">{line.map(shortcut => shortcut.replaceAll(' ', '\u00a0')).join(' · ')}</Text>
        </Box>
      </Box>
    </PageShortcutsContext.Provider>
  );
}

/** A form's save action, shown as a button row the form selects like any other row. */
export function SaveButton({
  label,
  selected,
  busyLabel,
}: {
  label: string;
  selected: boolean;
  /** Shown instead of the button while saving. */
  busyLabel?: string;
}): React.JSX.Element {
  if (busyLabel) {
    return <Text>{sanitizeTerminalText(busyLabel)}</Text>;
  }
  return (
    <Text color={selected ? 'cyan' : undefined} bold={selected}>
      {selected ? '› ' : '  '}[ {sanitizeTerminalText(label)} ]
    </Text>
  );
}

/**
 * A page for editing: the form's rows, then its save button, then the problems that stopped the
 * last save. The form validates when its save button is pressed and passes what it found here;
 * it keeps its own row selection and keys.
 */
export function EditPage({
  saveLabel,
  saveSelected,
  savingLabel,
  saving = false,
  problems = [],
  problemsTitle = 'Not saved:',
  after,
  children,
  ...page
}: PageProps & {
  saveLabel: string;
  saveSelected: boolean;
  saving?: boolean;
  savingLabel?: string;
  /** Why the last save was refused; nothing is shown while empty. */
  problems?: readonly string[];
  problemsTitle?: string;
  /** Other notes below the button, such as a confirmation that the save succeeded. */
  after?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Page {...page}>
      {children}
      <Box marginTop={1}>
        <SaveButton
          label={saveLabel}
          selected={saveSelected}
          {...(saving ? {busyLabel: savingLabel ?? 'Saving…'} : {})}
        />
      </Box>
      <ValidationError title={problemsTitle} problems={[...problems]} />
      {after}
    </Page>
  );
}
