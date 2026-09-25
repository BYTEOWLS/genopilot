import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {AccessionCacheDeleter, CacheScan, ScannedCopy} from '../../accessions/cache-discovery.js';
import {
  accessionDisplayName,
  recordedCacheState,
  withAccession,
  type AccessionEntry,
} from '../../accessions/catalog.js';
import type {AssemblyMetadataFetcher} from '../../accessions/ncbi-metadata.js';
import type {LoadedAccessionCatalog} from '../../accessions/store.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {AccessionForm, localFields, withLocalFields} from './accession-form.js';
import {Page} from '../components/page.js';
import type {AccessionsPageFrame} from './screen.js';
import type {AccessionCatalogUpdater} from '../../accessions/registration.js';

type View =
  | {kind: 'list'}
  | {kind: 'form'; editing?: string}
  | {kind: 'confirm-remove'; accession: string};

const visibleEntryCount = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unverifiedCopies(scan: CacheScan, accession: string): ScannedCopy[] {
  return scan.copies.filter(copy => copy.accession === accession && copy.state !== 'verified');
}

/** A short cache status; conflicts and damage come first so truncation never hides them. */
function cacheStatus(entry: AccessionEntry, scan: CacheScan): string {
  const damaged = unverifiedCopies(scan, entry.accession).length;
  const damage = damaged === 0 ? '' : `${String(damaged)} damaged`;
  switch (recordedCacheState(entry)) {
    case 'conflict':
      return ['conflicting copies', damage].filter(Boolean).join(', ');
    case 'cached': {
      const count = entry.cached_copies.length;
      return [count === 1 ? 'cached' : `cached ×${String(count)}`, damage].filter(Boolean).join(', ');
    }
    case 'not-cached':
      return damage.length > 0 ? `not cached, ${damage}` : 'not cached';
  }
}

function factsSummary(entry: AccessionEntry): string {
  if (!entry.ncbi) {
    return 'metadata not retrieved';
  }
  return [
    entry.ncbi.organism,
    entry.ncbi.assembly_name,
    entry.ncbi.strain,
    entry.ncbi.assembly_type,
    entry.ncbi.refseq_category,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
}

export function AccessionsTab({
  page,
  catalogPath,
  notice,
  loaded,
  scan,
  roots,
  inputActive,
  updateCatalog,
  fetchMetadata,
  deleteCaches,
  onCatalogChange,
  onRescan,
  onLockChange,
  verifying = false,
}: {
  page: AccessionsPageFrame;
  catalogPath: string;
  /** While caches are verified, removing and rescanning wait; a running scan could undo them. */
  verifying?: boolean;
  /** A problem from the last scan, shown above the list. */
  notice?: React.ReactNode;
  loaded: LoadedAccessionCatalog;
  scan: CacheScan;
  /** Every root discovery scans; removal deletes the accession's cache directories in these. */
  roots: readonly string[];
  inputActive: boolean;
  updateCatalog: AccessionCatalogUpdater;
  fetchMetadata: AssemblyMetadataFetcher;
  deleteCaches: AccessionCacheDeleter;
  onCatalogChange: (loaded: LoadedAccessionCatalog) => void;
  onRescan: () => void;
  onLockChange: (locked: boolean) => void;
}): React.JSX.Element {
  const entries = loaded.catalog.accessions;
  const [view, setView] = useState<View>({kind: 'list'});
  const [selected, setSelected] = useState<string | undefined>(entries[0]?.accession);
  const [message, setMessage] = useState<{text: string; error: boolean}>();
  const [busy, setBusy] = useState<string>();
  const locked = view.kind !== 'list' || busy !== undefined;
  useEffect(() => onLockChange(locked), [locked, onLockChange]);

  const selectedEntry = entries.find(entry => entry.accession === selected) ?? entries[0];

  const refreshMetadata = (entry: AccessionEntry): void => {
    setBusy(`Looking up NCBI metadata for ${entry.accession}…`);
    setMessage(undefined);
    fetchMetadata(entry.accession)
      .then(async result => {
        if (result.state === 'failed') {
          setMessage({text: `Metadata not refreshed: ${result.message}`, error: true});
          return;
        }
        const next = await updateCatalog(loaded.revision, latest => {
          const current = latest.accessions.find(candidate => candidate.accession === entry.accession);
          return current ? withAccession(latest, {...current, ncbi: result.metadata}) : latest;
        });
        onCatalogChange(next);
        setMessage({text: `Refreshed NCBI metadata for ${entry.accession}.`, error: false});
      })
      .catch(error => setMessage({text: errorMessage(error), error: true}))
      .finally(() => setBusy(undefined));
  };

  const remove = (accession: string): void => {
    setBusy(`Removing ${accession}…`);
    // Delete the cached files first: if that fails, the record stays and the researcher can see
    // what is still on disk instead of an orphaned cache that discovery would re-add.
    deleteCaches(roots, accession)
      .then(async deleted => {
        const next = await updateCatalog(loaded.revision, latest => ({
          ...latest,
          accessions: latest.accessions.filter(candidate => candidate.accession !== accession),
        }));
        onCatalogChange(next);
        setSelected(undefined);
        setMessage({
          text: deleted.length === 0
            ? `Removed ${accession}.`
            : `Removed ${accession} and deleted ${String(deleted.length)} cached ${deleted.length === 1 ? 'copy' : 'copies'}.`,
          error: false,
        });
        onRescan();
      })
      .catch(error => {
        setMessage({text: `${accession} was not removed: ${errorMessage(error)}`, error: true});
        onRescan();
      })
      .finally(() => {
        setBusy(undefined);
        setView({kind: 'list'});
      });
  };

  useInput(
    (input, key) => {
      if (busy !== undefined || view.kind === 'form') {
        return;
      }
      if (view.kind === 'confirm-remove') {
        if (input.toLowerCase() === 'y') {
          remove(view.accession);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          setView({kind: 'list'});
        }
        return;
      }
      if (input === 'n') {
        setMessage(undefined);
        setView({kind: 'form'});
        return;
      }
      if (verifying && (input === 'r' || input === 'd')) {
        setMessage({text: 'Wait until the caches are verified; a scan still running could undo this.', error: true});
        return;
      }
      if (input === 'r') {
        setMessage(undefined);
        onRescan();
        return;
      }
      if (!selectedEntry) {
        return;
      }
      if (key.upArrow || key.downArrow) {
        const index = entries.indexOf(selectedEntry);
        const offset = key.upArrow ? -1 : 1;
        setSelected(entries[(index + offset + entries.length) % entries.length]?.accession);
        setMessage(undefined);
      } else if (key.return) {
        setMessage(undefined);
        setView({kind: 'form', editing: selectedEntry.accession});
      } else if (input === 'm') {
        refreshMetadata(selectedEntry);
      } else if (input === 'd') {
        setMessage(undefined);
        setView({kind: 'confirm-remove', accession: selectedEntry.accession});
      }
    },
    {isActive: inputActive},
  );

  if (view.kind === 'form') {
    const editing = entries.find(entry => entry.accession === view.editing);
    return (
      <AccessionForm
        catalog={loaded.catalog}
        editing={editing}
        fetchMetadata={fetchMetadata}
        unverifiedCopies={editing ? unverifiedCopies(scan, editing.accession) : []}
        inputActive={inputActive}
        onCancel={() => setView({kind: 'list'})}
        onSubmit={async entry => {
          const next = await updateCatalog(loaded.revision, latest => editing
            ? withLocalFields(latest, entry.accession, localFields(entry.name ?? '', entry.description ?? ''))
            : withAccession(latest, entry));
          onCatalogChange(next);
          setSelected(entry.accession);
          setMessage({text: `Saved ${entry.accession}.`, error: false});
          setView({kind: 'list'});
        }}
      />
    );
  }

  const selectedIndex = selectedEntry ? entries.indexOf(selectedEntry) : -1;
  const visibleStart = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleEntryCount / 2), entries.length - visibleEntryCount),
  );
  const damagedCopies = scan.copies.filter(copy => copy.state !== 'verified');
  const removalTargets = view.kind === 'confirm-remove'
    ? scan.copies.filter(copy => copy.accession === view.accession)
    : [];

  return (
    <Page
      {...page}
      description={`Catalog: ${sanitizeTerminalText(catalogPath)}`}
      shortcuts={view.kind === 'confirm-remove'
        ? ['y — Remove']
        : ['↑/↓ — Select', 'Enter — Show and edit', 'n — Add', 'm — Refresh metadata', 'd — Remove', 'r — Rescan caches', 'Tab/←/→ — Tab']}
      back={view.kind === 'confirm-remove' ? 'Keep' : 'Back'}
    >
      {notice}
      {entries.length === 0 ? (
        <Text wrap="wrap">No accessions yet. Press n to add one; verified caches are added automatically.</Text>
      ) : null}
      {entries.slice(visibleStart, visibleStart + visibleEntryCount).map(entry => {
        const isSelected = entry.accession === selectedEntry?.accession;
        return (
          <Text key={entry.accession} color={isSelected ? 'cyan' : undefined} wrap="truncate">
            {isSelected ? '› ' : '  '}
            {sanitizeTerminalText(accessionDisplayName(entry))}
            {entry.name ? <Text color={mutedColor}> ({entry.accession})</Text> : null}
            {' · '}{cacheStatus(entry, scan)}
            {' · '}{sanitizeTerminalText(factsSummary(entry))}
          </Text>
        );
      })}
      {entries.length > visibleEntryCount ? (
        <Text color={mutedColor}>{selectedIndex + 1} of {entries.length}</Text>
      ) : null}

      {damagedCopies.length > 0 && view.kind === 'list' ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Damaged caches, not trusted</Text>
          {damagedCopies.map(copy => (
            <Text key={copy.path} color="red" wrap="wrap">
              ✖ {sanitizeTerminalText(copy.path)} — {sanitizeTerminalText(copy.problem ?? '')}
            </Text>
          ))}
        </Box>
      ) : null}

      {scan.ignored.length > 0 && view.kind === 'list' ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Skipped in caches</Text>
          {scan.ignored.map(entry => (
            <Text key={entry.path} color="yellow" wrap="wrap">
              – {sanitizeTerminalText(entry.path)} {sanitizeTerminalText(entry.reason)}
            </Text>
          ))}
        </Box>
      ) : null}

      {view.kind === 'confirm-remove' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" wrap="wrap">
            Remove {sanitizeTerminalText(view.accession)} from the catalog?
          </Text>
          {removalTargets.length === 0 ? (
            <Text wrap="wrap">No cached files exist for it under the known output roots.</Text>
          ) : (
            <>
              <Text color="yellow" wrap="wrap">
                Its cached assembly files will be deleted. A workflow that needs this accession
                will download it again.
              </Text>
              {removalTargets.map(copy => (
                <Text key={copy.path} wrap="wrap">  {sanitizeTerminalText(copy.path)}</Text>
              ))}
            </>
          )}
        </Box>
      ) : null}

      {busy ? <Box marginTop={1}><Text>{sanitizeTerminalText(busy)}</Text></Box> : null}
      {message ? (
        <Box marginTop={1}>
          <Text color={message.error ? 'red' : undefined} wrap="wrap">
            {message.error ? 'Error: ' : ''}{sanitizeTerminalText(message.text)}
          </Text>
        </Box>
      ) : null}
    </Page>
  );
}
