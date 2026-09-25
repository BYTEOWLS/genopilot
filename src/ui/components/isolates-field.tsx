import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {Isolate} from '../../isolates/catalog.js';
import {lineage, readPairsLabel} from '../../isolates/presentation.js';
import {loadIsolateCatalog} from '../../isolates/store.js';
import {resolveToolingPaths} from '../../tooling/paths.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {Page} from './page.js';

export type IsolateCatalogReader = () => Promise<readonly Isolate[]>;

export const readCatalogedIsolates: IsolateCatalogReader = async () =>
  (await loadIsolateCatalog(resolveToolingPaths().isolateCatalogPath)).catalog.isolates;

/** The isolate catalog as a form offers it: still loading, loaded, or unreadable. */
export type IsolateChoices =
  | {state: 'loading'}
  | {state: 'ready'; isolates: readonly Isolate[]}
  | {state: 'failed'; message: string};

/**
 * Loads the catalog for a form, once and again whenever `reloadKey` changes, such as when the
 * picker opens, so the picker shows current entries without reloading on every re-render or
 * every time the field scrolls back into view. Nothing is loaded while `enabled` is false.
 */
export function useIsolateChoices(
  loadIsolates: IsolateCatalogReader,
  enabled = true,
  reloadKey = 0,
): IsolateChoices {
  const [choices, setChoices] = useState<IsolateChoices>({state: 'loading'});
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    loadIsolates().then(
      isolates => {
        if (active) {
          setChoices({state: 'ready', isolates});
        }
      },
      error => {
        if (active) {
          setChoices({state: 'failed', message: error instanceof Error ? error.message : String(error)});
        }
      },
    );
    return () => {
      active = false;
    };
  }, [loadIsolates, enabled, reloadKey]);
  return choices;
}

/** A form keeps the selection as comma-separated isolate IDs, in the order they were chosen. */
export function parseIsolateSelection(value: string): string[] {
  return value.split(',').map(id => id.trim()).filter(id => id.length > 0);
}

export function formatIsolateSelection(ids: readonly string[]): string {
  return ids.join(',');
}

/** The line under the field: how many isolates are selected, and any that are no longer cataloged. */
export function isolateSelectionHint(
  ids: readonly string[],
  choices: IsolateChoices,
): {text: string; color?: string} {
  if (choices.state === 'loading') {
    return {text: 'Loading the isolate catalog…'};
  }
  if (choices.state === 'failed') {
    return {text: 'Isolate catalog unavailable — fix it under Manage isolates', color: 'yellow'};
  }
  if (choices.isolates.length === 0) {
    return {text: 'No isolates cataloged yet — add them under Manage isolates', color: 'yellow'};
  }
  const stale = ids.filter(id => !choices.isolates.some(isolate => isolate.id === id));
  if (stale.length > 0) {
    return {text: `No longer cataloged: ${stale.join(', ')} — press Enter to choose again`, color: 'yellow'};
  }
  return {text: `${String(choices.isolates.length)} cataloged — press Enter to choose`};
}

function selectionSummary(ids: readonly string[], choices: IsolateChoices): string {
  if (ids.length === 0) {
    return 'None selected';
  }
  const names = ids.map(id =>
    choices.state === 'ready' ? choices.isolates.find(isolate => isolate.id === id)?.name ?? id : id);
  return `${String(ids.length)} selected: ${names.join(', ')}`;
}

/**
 * One or more isolates chosen with Enter from the isolate catalog, which its form loads (see
 * `useIsolateChoices`). The selection is derived from the chosen IDs; there is no count to enter.
 *
 * While `choosing`, the field renders only the picker, so its form shows nothing else and ignores
 * its own keys; the form owns that state so it can do both.
 */
export function IsolatesField({
  label,
  required = false,
  selected,
  inputActive,
  value,
  onChange,
  choosing,
  onChoosingChange,
  choices,
}: {
  label: string;
  required?: boolean;
  selected: boolean;
  inputActive: boolean;
  value: string;
  onChange: (value: string) => void;
  choosing: boolean;
  onChoosingChange: (choosing: boolean) => void;
  choices: IsolateChoices;
}): React.JSX.Element {
  const ids = parseIsolateSelection(value);
  useInput(
    (_input, key) => {
      if (key.return) {
        onChoosingChange(true);
      }
    },
    {isActive: inputActive && selected && !choosing},
  );

  if (choosing) {
    return (
      <IsolatePicker
        fieldLabel={label}
        choices={choices}
        initialIds={ids}
        onConfirm={chosen => {
          onChange(formatIsolateSelection(chosen));
          onChoosingChange(false);
        }}
        onCancel={() => onChoosingChange(false)}
        inputActive={inputActive}
      />
    );
  }

  const hint = isolateSelectionHint(ids, choices);
  return (
    <>
      <Text color={selected ? 'cyan' : undefined} wrap="truncate">
        {selected ? '› ' : '  '}
        {sanitizeTerminalText(label)}
        {required ? '*' : ''}:{' '}
        <Text color={selected ? undefined : mutedColor}>{sanitizeTerminalText(selectionSummary(ids, choices))}</Text>
      </Text>
      <Text color={hint.color ?? mutedColor} wrap="truncate">{'  '}{sanitizeTerminalText(hint.text)}</Text>
    </>
  );
}

const visibleIsolateCount = 10;

/** Lowercase letters and digits only, so a search needs no spaces or punctuation. */
function searchable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Lists the cataloged isolates to choose several: typing filters by name or ID, Space toggles
 * the highlighted isolate, and Enter confirms. Esc keeps the previous selection.
 */
export function IsolatePicker({
  fieldLabel,
  choices,
  initialIds,
  onConfirm,
  onCancel,
  inputActive,
}: {
  fieldLabel: string;
  choices: IsolateChoices;
  initialIds: readonly string[];
  onConfirm: (ids: string[]) => void;
  onCancel: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  // Typed letters go to the search, including `h`.
  useHomeSuspension('typing');
  const isolates = choices.state === 'ready' ? choices.isolates : [];
  // Selected IDs no longer in the catalog are dropped here, so confirming never keeps them.
  const [chosen, setChosen] = useState<string[]>(() => [...initialIds]);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const filtered = isolates.filter(isolate =>
    searchable(isolate.name).includes(searchable(query)) || searchable(isolate.id).includes(searchable(query)));
  const highlightedIndex = Math.min(highlighted, Math.max(0, filtered.length - 1));
  const highlightedIsolate = filtered[highlightedIndex];
  const cataloged = chosen.filter(id => isolates.some(isolate => isolate.id === id));

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      // With nothing to choose from, only Esc leaves the picker.
      if (isolates.length === 0) {
        return;
      }
      if (key.return) {
        onConfirm(cataloged);
      } else if (key.upArrow || key.downArrow) {
        if (filtered.length > 0) {
          const offset = key.upArrow ? -1 : 1;
          setHighlighted((highlightedIndex + offset + filtered.length) % filtered.length);
        }
      } else if (input === ' ') {
        if (highlightedIsolate) {
          const id = highlightedIsolate.id;
          setChosen(current => current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id]);
        }
      } else if (key.backspace || key.delete) {
        setQuery(current => current.slice(0, -1));
        setHighlighted(0);
      } else if (input.length > 0 && !key.ctrl && !key.meta && !key.tab && /^[\x20-\x7e]+$/.test(input)) {
        setQuery(current => current + input);
        setHighlighted(0);
      }
    },
    {isActive: inputActive},
  );

  const visibleStart = Math.max(
    0,
    Math.min(highlightedIndex - Math.floor(visibleIsolateCount / 2), filtered.length - visibleIsolateCount),
  );
  return (
    <Page
      title="Choose isolates"
      detail={`${String(cataloged.length)} selected`}
      description={`For ${sanitizeTerminalText(fieldLabel)}, from the isolate catalog. To add or edit isolates, use Manage isolates.`}
      shortcuts={isolates.length > 0 ? ['Type — Search', '↑/↓ — Move', 'Space — Select', 'Enter — Done'] : []}
      back="Cancel"
    >
      {choices.state === 'loading' ? <Text>Loading the isolate catalog…</Text> : null}
      {choices.state === 'failed' ? (
        <>
          <Text color="red">Unable to load the isolate catalog.</Text>
          <Text wrap="wrap">{sanitizeTerminalText(choices.message)}</Text>
        </>
      ) : null}
      {choices.state === 'ready' && isolates.length === 0 ? (
        <Text wrap="wrap">No isolates cataloged yet. Add them under Manage isolates, then configure the run again.</Text>
      ) : null}
      {isolates.length > 0 ? (
        <Text>
          Search: {query.length > 0 ? sanitizeTerminalText(query) : <Text color={mutedColor}>type to filter by name or ID</Text>}
        </Text>
      ) : null}
      {isolates.length > 0 && filtered.length === 0 ? <Text color={mutedColor}>No isolate matches.</Text> : null}
      <Box flexDirection="column" marginTop={isolates.length > 0 ? 1 : 0}>
        {filtered.slice(visibleStart, visibleStart + visibleIsolateCount).map((isolate, offset) => {
          const isHighlighted = visibleStart + offset === highlightedIndex;
          const isChosen = chosen.includes(isolate.id);
          return (
            <Text key={isolate.id} color={isHighlighted ? 'cyan' : undefined} wrap="truncate">
              {isHighlighted ? '› ' : '  '}[{isChosen ? '✔' : ' '}] {sanitizeTerminalText(isolate.name)}
              <Text color={mutedColor}> ({sanitizeTerminalText(isolate.id)})</Text>
              {' · '}{sanitizeTerminalText(readPairsLabel(isolate))}
              {' · '}{sanitizeTerminalText(lineage(isolate))}
            </Text>
          );
        })}
      </Box>
      {filtered.length > visibleIsolateCount ? (
        <Text color={mutedColor}>{highlightedIndex + 1} of {filtered.length}</Text>
      ) : null}
    </Page>
  );
}
