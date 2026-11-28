import React, {useEffect, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {Alert} from '@inkjs/ui';
import {genomeSelection, selectedGenome} from '../../accessions/selection.js';
import {sameReference} from '../../accessions/provider.js';
import {accessionSources} from '../../accessions/registry.js';
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
import {Section} from './section.js';
import {SelectableList} from './selectable-list.js';

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
  | 'not-downloaded'
  | 'cataloged'
  | 'conflict';

export type AccessionHint = {kind: AccessionHintKind; text: string; color?: string};

/** The line under the field: whether the value is usable and what the catalog knows about it. */
export function accessionHint(value: string, choices: AccessionChoices): AccessionHint {
  const reference = selectedGenome(value);
  const accession = reference?.id ?? value.trim();
  const valid = reference !== undefined;
  const accessionMenuLabel = "\"Manage accessions\""
  if (accession.length > 0 && !valid) {
    return {kind: 'invalid', text: 'Choose a downloaded genome from the catalog', color: 'yellow'};
  }
  if (choices.state === 'loading') {
    return {kind: 'loading', text: 'Loading the accession catalog…'};
  }
  if (choices.state === 'failed') {
    return {
      kind: 'unavailable',
      text: 'Accession catalog unavailable — reopen the field to retry',
      color: 'yellow',
    };
  }
  if (!valid) {
    return {
      kind: 'empty',
      text: `${String(choices.entries.length)} cataloged — press Enter to choose`,
      // text: choices.entries.length === 0
      //     ? `Download a genome in ${accessionMenuLabel} first`
      //   : `${String(choices.entries.length)} cataloged — press Enter to choose`,
    };
  }
  const entry = choices.entries.find(candidate => reference && sameReference(candidate, reference));
  if (!entry) {
    return {kind: 'uncataloged', text: `Not in the accession catalog — download it in ${accessionMenuLabel}`, color: 'yellow'};
  }
  if (recordedCacheState(entry) === 'conflict') {
    return {
      kind: 'conflict',
      text: `${accessionDisplayName(entry)} has conflicting cached copies and cannot be used — press Enter for details`,
      color: 'yellow',
    };
  }
  if (!entry.cached_copies.some(copy => copy.fasta_sha256)) {
    return {kind: 'not-downloaded', text: 'Download genomic FASTA in Manage accessions first', color: 'yellow'};
  }
  return {kind: 'cataloged', text: [accessionDisplayName(entry), accessionFactsSummary(entry), cacheLabel(entry)].join(' · ')};
}

/**
 * A genome chosen from any registered catalog provider, with a snapshotted reference.
 * Only downloaded genomic FASTA entries can be chosen; the form checks role-required files on save.
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
  placeholder = 'Press Enter to choose a downloaded genome',
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
        initialAccession={value}
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
  const reference = selectedGenome(value);
  const shownValue = reference?.id ?? '';
  return (
    <>
      <TextField
        label={label}
        required={required}
        selected={selected}
        inputActive={inputActive}
        editable={false}
        defaultValue={shownValue}
        displayValue={shownValue.length > 0 ? shownValue : 'Not set'}
        placeholder={placeholder}
        onChange={onChange}
      />
      <Text color={hint.color ?? mutedColor} wrap="truncate">{'  '}{sanitizeTerminalText(hint.text)}</Text>
    </>
  );
}

/** Explains why an accession whose cached copies disagree cannot be chosen, listing the copies. */
function ConflictExplanation({entry, maxCopies}: {entry: AccessionEntry; maxCopies: number}): React.JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      <Alert variant="warning">
        Cached copies disagree. Inspect this genome in Manage accessions before selecting it.
      </Alert>
      {entry.cached_copies.slice(0, maxCopies).map(copy => (
        <Text key={copy.path} color={mutedColor} wrap="truncate">
          {'  '}{sanitizeTerminalText(copy.path)} · FASTA {copy.fasta_sha256?.slice(0, 12) ?? 'not downloaded'}
          {copy.gff3_sha256 ? ` · GFF3 ${copy.gff3_sha256.slice(0, 12)}` : ''}
        </Text>
      ))}
      {entry.cached_copies.length > maxCopies ? <Text color={mutedColor} wrap="truncate">{entry.cached_copies.length - maxCopies} more copies; inspect them in Manage accessions.</Text> : null}
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
  const {rows} = useWindowSize();
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Preselect the current value once the catalog has loaded.
  useEffect(() => {
    const reference = selectedGenome(initialAccession ?? '');
    setSelectedIndex(Math.max(0, entries.findIndex(entry => reference && sameReference(entry, reference))));
  }, [entries, initialAccession]);
  const selectedEntry = entries[selectedIndex];
  const selectedConflicts = selectedEntry !== undefined && recordedCacheState(selectedEntry) === 'conflict';
  const canSelect = selectedEntry !== undefined && !selectedConflicts && selectedEntry.cached_copies.some(copy => copy.fasta_sha256);

  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (entries.length === 0) {
        return;
      }
      if (key.return && selectedEntry && canSelect) {
        onSelect(genomeSelection(selectedEntry));
      }
    },
    {isActive: inputActive},
  );

  const menuLabel = "\"Manage accessions\""

  return (
    <Page
      title="Choose an accession"
      description={selectedConflicts ? `For ${sanitizeTerminalText(fieldLabel)}.` : `For ${sanitizeTerminalText(fieldLabel)}, from the accession catalog. To add one, use Manage accessions.`}
      shortcuts={entries.length > 0 ? [canSelect && 'Enter — Choose'] : []}
      back="Cancel"
    >
      {choices.state === 'loading' ? <Text>Loading the accession catalog…</Text> : null}
      {choices.state === 'failed' ? (
        <>
        <Alert variant="error">
          Unable to load the accession catalog.
          {sanitizeTerminalText(choices.message)}
        </Alert>
        </>
      ) : null}
      {choices.state === 'ready' && entries.length === 0 ? (
          <Alert variant="warning">No accessions cataloged yet. Download a genome in {menuLabel} first.</Alert>
      ) : null}
      {entries.length > 0 ? <Section title="Catalog genomes" marginTop={0}>
        <SelectableList count={entries.length} selectedIndex={selectedIndex} onSelect={setSelectedIndex}
          active={inputActive} height={Math.max(2, rows - 10 - (selectedConflicts ? 8 : canSelect ? 0 : 1))} noun="genomes"
          renderItem={(index, selected) => {
            const entry = entries[index]!;
            const conflict = recordedCacheState(entry) === 'conflict';
            return <Text color={selected ? 'cyan' : undefined} wrap="truncate">
              {selected ? '› ' : '  '}{conflict ? '⚠ ' : ''}{sanitizeTerminalText(accessionDisplayName(entry))}
              {entry.name ? <Text color={mutedColor}> ({entry.id})</Text> : null}
              {' · '}{sanitizeTerminalText(accessionSources.get(entry.source).label)}{' · '}
              <Text color={conflict ? 'yellow' : undefined}>{cacheLabel(entry)}</Text>
              {' · '}{sanitizeTerminalText(accessionFactsSummary(entry))}
            </Text>;
          }} />
      </Section> : null}
      {selectedEntry && !selectedConflicts && !canSelect ? <Text color="yellow" wrap="truncate">Download genomic FASTA in {menuLabel} first.</Text> : null}
      {selectedEntry && selectedConflicts ? <ConflictExplanation entry={selectedEntry} maxCopies={Math.max(0, Math.min(2, rows - 16))} /> : null}
    </Page>
  );
}
