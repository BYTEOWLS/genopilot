import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {isVersionedAssemblyAccession, normalizeAccession} from '../../accessions/accession.js';
import {
  accessionDisplayName,
  accessionFactsSummary,
  recordedCacheState,
  type AccessionEntry,
} from '../../accessions/catalog.js';
import {readCatalogedAccessions, type AccessionCatalogReader} from '../../accessions/store.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {Page} from './page.js';
import {TextField} from './text-field.js';

/** The accession catalog as a form offers it: still loading, loaded, or unreadable. */
export type AccessionChoices =
  | {state: 'loading'}
  | {state: 'ready'; entries: readonly AccessionEntry[]}
  | {state: 'failed'; message: string};

/** Loads the catalog once per mount, so an opened picker shows its current entries. */
function useAccessionChoices(loadAccessions: AccessionCatalogReader): AccessionChoices {
  const [choices, setChoices] = useState<AccessionChoices>({state: 'loading'});
  useEffect(() => {
    let active = true;
    loadAccessions().then(
      entries => {
        if (active) {
          setChoices({state: 'ready', entries});
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
  }, [loadAccessions]);
  return choices;
}

const visibleEntryCount = 12;
const noEntries: readonly AccessionEntry[] = [];

function cacheLabel(entry: AccessionEntry): string {
  switch (recordedCacheState(entry)) {
    case 'cached':
      return 'cached';
    case 'not-cached':
      return 'not cached';
    case 'conflict':
      return 'conflicting copies — cannot be used';
  }
}

export type AccessionHintKind =
  | 'empty'
  | 'loading'
  | 'unavailable'
  | 'invalid'
  | 'uncataloged'
  | 'cataloged'
  | 'conflict';

export type AccessionHint = {kind: AccessionHintKind; text: string; color?: string};

/** The line under the field: whether the value is usable and what the catalog knows about it. */
export function accessionHint(value: string, choices: AccessionChoices): AccessionHint {
  const accession = normalizeAccession(value);
  const valid = isVersionedAssemblyAccession(accession);
  if (accession.length > 0 && !valid) {
    return {kind: 'invalid', text: 'Not a versioned NCBI assembly accession, e.g. GCF_000149205.2', color: 'yellow'};
  }
  if (choices.state === 'loading') {
    return {kind: 'loading', text: valid ? 'Valid format · checking the accession catalog…' : 'Loading the accession catalog…'};
  }
  if (choices.state === 'failed') {
    return {
      kind: 'unavailable',
      text: valid
        ? 'Valid format · accession catalog unavailable, so it was not checked'
        : 'Accession catalog unavailable — type or paste the accession',
      color: 'yellow',
    };
  }
  if (!valid) {
    return {
      kind: 'empty',
      text: choices.entries.length === 0
        ? 'No accessions cataloged yet — type or paste one'
        : `${String(choices.entries.length)} cataloged — press Enter to choose`,
    };
  }
  const entry = choices.entries.find(candidate => candidate.accession === accession);
  if (!entry) {
    return {kind: 'uncataloged', text: 'Valid; not in the accession catalog'};
  }
  if (recordedCacheState(entry) === 'conflict') {
    return {
      kind: 'conflict',
      text: `${accessionDisplayName(entry)} has conflicting cached copies and cannot be used — press Enter for details`,
      color: 'yellow',
    };
  }
  return {kind: 'cataloged', text: [accessionDisplayName(entry), accessionFactsSummary(entry), cacheLabel(entry)].join(' · ')};
}

/**
 * A versioned NCBI assembly accession that is typed or pasted, or chosen with Enter from the
 * accession catalog, which the field reads itself. The line below it says whether the value is
 * valid and what the catalog knows about it; the form still validates on save.
 *
 * While `choosing`, the field renders only the catalog picker, so its form shows nothing else and
 * ignores its own keys; the form owns that state so it can do both.
 */
export function AccessionField({
  label,
  required = false,
  selected,
  inputActive,
  value,
  onChange,
  choosing,
  onChoosingChange,
  loadAccessions = readCatalogedAccessions,
  placeholder = 'Type or paste an accession, or press Enter to choose',
}: {
  label: string;
  required?: boolean;
  selected: boolean;
  inputActive: boolean;
  value: string;
  onChange: (value: string) => void;
  choosing: boolean;
  onChoosingChange: (choosing: boolean) => void;
  loadAccessions?: AccessionCatalogReader;
  placeholder?: string;
}): React.JSX.Element {
  const choices = useAccessionChoices(loadAccessions);
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
      <AccessionPicker
        fieldLabel={label}
        choices={choices}
        initialAccession={normalizeAccession(value)}
        onSelect={accession => {
          onChange(accession);
          onChoosingChange(false);
        }}
        onCancel={() => onChoosingChange(false)}
        inputActive={inputActive}
      />
    );
  }

  const hint = accessionHint(value, choices);
  return (
    <>
      <TextField
        label={label}
        required={required}
        selected={selected}
        inputActive={inputActive}
        defaultValue={value}
        displayValue={value.length > 0 ? value : 'Not set'}
        placeholder={placeholder}
        onChange={onChange}
      />
      <Text color={hint.color ?? mutedColor} wrap="truncate">{'  '}{sanitizeTerminalText(hint.text)}</Text>
    </>
  );
}

/** Explains why an accession whose cached copies disagree cannot be chosen, listing the copies. */
function ConflictExplanation({entry}: {entry: AccessionEntry}): React.JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="yellow" bold>⚠ {sanitizeTerminalText(entry.accession)} cannot be used: its cached copies conflict</Text>
      <Text wrap="wrap">
        A versioned accession always names the same assembly files, so every cached copy of it must
        have identical checksums. These copies differ, so at least one was damaged or changed after
        it was downloaded, and GenoPilot cannot tell which one is right.
      </Text>
      <Text wrap="wrap">
        Remove the entry under Manage NCBI accessions, which deletes its cached copies, and add it
        again; the next run downloads a fresh copy.
      </Text>
      {entry.cached_copies.map(copy => (
        <Text key={copy.path} color={mutedColor} wrap="wrap">
          {'  '}{sanitizeTerminalText(copy.path)} · FASTA {copy.fasta_sha256.slice(0, 12)}
          {copy.gff3_sha256 ? ` · GFF3 ${copy.gff3_sha256.slice(0, 12)}` : ''}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Lists the cataloged accessions to choose one; the current value is preselected. An accession
 * whose cached copies conflict is listed with an explanation but cannot be chosen.
 */
export function AccessionPicker({
  fieldLabel,
  choices,
  initialAccession,
  onSelect,
  onCancel,
  inputActive,
}: {
  /** The field the choice is for, shown in the description. */
  fieldLabel: string;
  choices: AccessionChoices;
  initialAccession?: string;
  onSelect: (accession: string) => void;
  onCancel: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const entries = choices.state === 'ready' ? choices.entries : noEntries;
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Preselect the current value once the catalog has loaded.
  useEffect(() => {
    setSelectedIndex(Math.max(0, entries.findIndex(entry => entry.accession === initialAccession)));
  }, [entries, initialAccession]);
  const selectedEntry = entries[selectedIndex];
  const selectedConflicts = selectedEntry !== undefined && recordedCacheState(selectedEntry) === 'conflict';

  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (entries.length === 0) {
        return;
      }
      if (key.upArrow || key.downArrow) {
        const offset = key.upArrow ? -1 : 1;
        setSelectedIndex(index => (index + offset + entries.length) % entries.length);
      } else if (key.return && selectedEntry && !selectedConflicts) {
        onSelect(selectedEntry.accession);
      }
    },
    {isActive: inputActive},
  );

  const visibleStart = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleEntryCount / 2), entries.length - visibleEntryCount),
  );

  return (
    <Page
      title="Choose an accession"
      description={`For ${sanitizeTerminalText(fieldLabel)}, from the accession catalog. To add one, use Manage NCBI accessions.`}
      shortcuts={entries.length > 0 ? ['↑/↓ — Select', !selectedConflicts && 'Enter — Choose'] : []}
      back="Cancel"
    >
      {choices.state === 'loading' ? <Text>Loading the accession catalog…</Text> : null}
      {choices.state === 'failed' ? (
        <>
          <Text color="red">Unable to load the accession catalog.</Text>
          <Text wrap="wrap">{sanitizeTerminalText(choices.message)}</Text>
        </>
      ) : null}
      {choices.state === 'ready' && entries.length === 0 ? (
        <Text wrap="wrap">No accessions cataloged yet. Type or paste the accession into the field instead.</Text>
      ) : null}
      {entries.slice(visibleStart, visibleStart + visibleEntryCount).map((entry, offset) => {
        const selected = visibleStart + offset === selectedIndex;
        const conflict = recordedCacheState(entry) === 'conflict';
        return (
          <Text key={entry.accession} color={selected ? 'cyan' : undefined} wrap="truncate">
            {selected ? '› ' : '  '}
            {conflict ? '⚠ ' : ''}
            {sanitizeTerminalText(accessionDisplayName(entry))}
            {entry.name ? <Text color={mutedColor}> ({entry.accession})</Text> : null}
            {' · '}
            <Text color={conflict ? 'yellow' : undefined}>{cacheLabel(entry)}</Text>
            {' · '}{sanitizeTerminalText(accessionFactsSummary(entry))}
          </Text>
        );
      })}
      {entries.length > visibleEntryCount ? (
        <Text color={mutedColor}>{selectedIndex + 1} of {entries.length}</Text>
      ) : null}
      {selectedEntry && selectedConflicts ? <ConflictExplanation entry={selectedEntry} /> : null}
    </Page>
  );
}
