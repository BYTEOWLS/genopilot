import {referenceKey, sameReference, type GenomeReference, type GenomeDownloadProgress} from '../../accessions/provider.js';
import {resolveGenomeCache, type VerifiedGenome} from '../../accessions/cache.js';
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import type {AccessionCacheDeleter, CacheScan, ScannedCopy} from '../../accessions/cache-discovery.js';
import {
  accessionDisplayName,
  recordedCacheState,
  withAccession,
  type AccessionEntry,
} from '../../accessions/catalog.js';
import {missingProviderFields, type GenomeProviderRegistry} from '../../accessions/provider.js';
import {providerError, type ProviderSettings} from '../../tooling/provider-settings.js';
import {DownloadForm, type CatalogDownloader} from './download-form.js';
import type {LoadedAccessionCatalog} from '../../accessions/store.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {useHomeSuspension} from '../home-navigation.js';
import {mutedColor} from '../theme.js';
import {AccessionForm, localFields, withLocalFields, type AccessionMessage} from './accession-form.js';
import {Page} from '../components/page.js';
import {Section} from '../components/section.js';
import {SelectableList} from '../components/selectable-list.js';
import type {AccessionsPageFrame} from './screen.js';
import type {AccessionCatalogUpdater} from '../../accessions/registration.js';
import {accessionGenomeView} from '../../accessions/views.js';
import {useGenomeSession} from '../../browser/use-genome-session.js';
import {browserUnavailableShortcut, browserViewShortcut} from '../../browser/contract.js';

type View =
  | {kind: 'list'}
  | {kind: 'form'; editing: GenomeReference}
  | {kind: 'download'}
  | {kind: 'confirm-remove'; reference: GenomeReference};

/** Lines of the accession list, including its position line. */
const listHeight = 9;

function downloadMessage(genome: VerifiedGenome, registry: GenomeProviderRegistry): AccessionMessage {
  const unavailable = genome.annotation === 'unavailable';
  const text = unavailable ? 'Genome verified. Annotation is unavailable; this FASTA can be used for roles that do not require GFF3.' : 'Selected artifacts downloaded and verified.';
  const summary = registry.get(genome.reference.source).downloadSummary?.(genome.facts);
  return {text: summary ? `${text} ${summary}` : text, variant: unavailable ? 'warning' : 'info'};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unverifiedCopies(scan: CacheScan, reference: GenomeReference): ScannedCopy[] {
  return scan.copies.filter(copy => sameReference(copy, reference) && copy.state !== 'verified');
}

/** A short cache status; conflicts and damage come first so truncation never hides them. */
function cacheStatus(entry: AccessionEntry, scan: CacheScan): string {
  const damaged = unverifiedCopies(scan, entry).length;
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

export function AccessionsTab({
  page,
  catalogPath,
  notice,
  loaded,
  scan,
  roots,
  inputActive,
  updateCatalog,
  registry,
  settings,
  download,
  onConfigure,
  defaultRoot,
  deleteCaches,
  onCatalogChange,
  onRescan,
  onLockChange,
  verifying = false,
  buildGenomeView = accessionGenomeView,
}: {
  page: AccessionsPageFrame;
  buildGenomeView?: typeof accessionGenomeView;
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
  registry: GenomeProviderRegistry;
  settings: ProviderSettings;
  download?: CatalogDownloader;
  defaultRoot: string;
  onConfigure: (source: string) => void;
  deleteCaches: AccessionCacheDeleter;
  onCatalogChange: (loaded: LoadedAccessionCatalog) => void;
  onRescan: () => void;
  onLockChange: (locked: boolean) => void;
}): React.JSX.Element {
  const entries = loaded.catalog.accessions;
  const [view, setView] = useState<View>({kind: 'list'});
  const [selected, setSelected] = useState<string | undefined>(entries[0] ? referenceKey(entries[0]) : undefined);
  const [message, setMessage] = useState<AccessionMessage>();
  const [operationBusy, setBusy] = useState<string>();
  const [downloadProgress, setDownloadProgress] = useState<GenomeDownloadProgress>();
  const [providerNotice, setProviderNotice] = useState<{text: string; required: boolean}>();
  const metadataController = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => metadataController.current?.abort(), []);
  const genome = useGenomeSession(JSON.stringify([inputActive, view.kind]));
  const browser = genome.browser;
  const busy = genome.busy ? 'Checking cached genome files…' : operationBusy;
  const locked = view.kind !== 'list' || busy !== undefined;
  useHomeSuspension(busy ? 'busy' : undefined);
  useEffect(() => onLockChange(locked), [locked, onLockChange]);

  const selectedEntry = entries.find(entry => referenceKey(entry) === selected) ?? entries[0];
  useEffect(() => {
    let active = true;
    setProviderNotice(undefined);
    if (selectedEntry && inputActive) {
      const provider = registry.get(selectedEntry.source);
      void settings.read(provider).then(secrets => {
        if (!active) { return; }
        const required = missingProviderFields(provider, secrets).length > 0;
        if (required) {
          setProviderNotice({required, text: 'Required provider credentials are missing. Remote operations are blocked; verified local copies remain usable.'});
        }
      }, () => { if (active) { setProviderNotice({text: 'Unable to read provider settings.', required: true}); } });
    }
    return () => { active = false; };
  }, [selectedEntry?.source, inputActive, registry, settings]);
  const canView = !!browser?.browserAvailable && !verifying && !!selectedEntry && recordedCacheState(selectedEntry) === 'cached' &&
    scan.copies.some(copy => copy.state === 'verified' && copy.fasta_sha256 && selectedEntry.cached_copies.some(recorded => recorded.path === copy.path && recorded.fasta_sha256 === copy.fasta_sha256));
  const openGenome = (entry: AccessionEntry): void => {
    if (!browser || !canView) {
      return;
    }
    setMessage(undefined);
    genome.open(signal => buildGenomeView(entry, browser.application, signal));
  };

  const refreshMetadata = async (entry: AccessionEntry): Promise<void> => {
    const provider = registry.get(entry.source);
    if (!provider.lookupMetadata) {
      return;
    }
    setBusy(`Looking up metadata for ${entry.id}…`);
    let secrets: Record<string, string> = {};
    const abort = new AbortController();
    metadataController.current = abort;
    try {
      secrets = await settings.read(provider);
      abort.signal.throwIfAborted();
      if (missingProviderFields(provider, secrets).length) {
        throw new Error('Configure provider credentials in Manage tooling before looking up metadata.');
      }
      const metadata = await provider.lookupMetadata(entry, {signal: abort.signal, secrets});
      abort.signal.throwIfAborted();
      provider.validateMetadata(metadata);
      const next = await updateCatalog(loaded.revision, latest => {
        const current = latest.accessions.find(candidate => sameReference(candidate, entry));
        return current ? withAccession(latest, {...current, metadata}) : latest;
      });
      onCatalogChange(next);
      setMessage({text: `Refreshed metadata for ${entry.id}.`, variant: 'info'});
    } catch (error) {
      throw new Error(abort.signal.aborted ? 'Metadata lookup cancelled.' : providerError(error, secrets));
    } finally {
      metadataController.current = undefined;
      setBusy(undefined);
    }
  };

  const downloadEntry = async (entry: AccessionEntry, signal: AbortSignal): Promise<void> => {
    if (verifying) {
      throw new Error('Wait until the cache scan finishes before downloading.');
    }
    const provider = registry.get(entry.source);
    let secrets: Record<string, string> = {};
    setMessage(undefined);
    setDownloadProgress({phase: 'requesting'});
    try {
      secrets = await settings.read(provider);
      signal.throwIfAborted();
      if (missingProviderFields(provider, secrets).length) {
        throw new Error('Configure provider credentials in Manage tooling before downloading.');
      }
      const genome = await (download ?? resolveGenomeCache)({
        reference: {source: entry.source, id: entry.id, parameters: entry.parameters},
        kinds: provider.artifacts.map(artifact => artifact.kind), root: defaultRoot, mode: 'refresh',
      }, {signal, secrets, onProgress: setDownloadProgress}, registry);
      signal.throwIfAborted();
      const next = await updateCatalog(loaded.revision, latest => {
        const current = latest.accessions.find(candidate => sameReference(candidate, entry));
        return current ? withAccession(latest, {...current, metadata: genome.metadata}) : latest;
      });
      onCatalogChange(next);
      setMessage(downloadMessage(genome, registry));
      onRescan();
    } catch (error) {
      throw new Error(providerError(error, secrets));
    } finally {
      setDownloadProgress(undefined);
    }
  };

  const remove = (reference: GenomeReference): void => {
    const accession = reference.id;
    setBusy(`Removing ${accession}…`);
    // Delete the cached files first: if that fails, the record stays and the researcher can see
    // what is still on disk instead of an orphaned cache that discovery would re-add.
    deleteCaches(roots, reference)
      .then(async deleted => {
        const next = await updateCatalog(loaded.revision, latest => ({
          ...latest,
          accessions: latest.accessions.filter(candidate => !sameReference(candidate, reference)),
        }));
        onCatalogChange(next);
        setSelected(undefined);
        setMessage({
          text: deleted.length === 0
            ? `Removed ${accession}.`
            : `Removed ${accession} and deleted ${String(deleted.length)} cached ${deleted.length === 1 ? 'copy' : 'copies'}.`,
          variant: 'info',
        });
        onRescan();
      })
      .catch(error => {
        setMessage({text: `${accession} was not removed: ${errorMessage(error)}`, variant: 'error'});
        onRescan();
      })
      .finally(() => {
        setBusy(undefined);
        setView({kind: 'list'});
      });
  };

  useInput(
    (input, key) => {
      if (busy !== undefined || view.kind === 'form' || view.kind === 'download') {
        return;
      }
      genome.clearError();
      if (view.kind === 'confirm-remove') {
        if (input.toLowerCase() === 'y') {
          remove(view.reference);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          setView({kind: 'list'});
        }
        return;
      }
      if (verifying && (input === 'r' || input === 'd' || input === 'n')) {
        setMessage({text: 'Wait until the caches are verified; a scan still running could undo this.', variant: 'warning'});
        return;
      }
      if (input === 'n') {
        setMessage(undefined);
        setView({kind: 'download'});
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
      if (input === 'v') {
        openGenome(selectedEntry);
      } else if (key.return) {
        setMessage(undefined);
        setView({kind: 'form', editing: selectedEntry});
      } else if (input === 'd') {
        setMessage(undefined);
        setView({kind: 'confirm-remove', reference: selectedEntry});
      }
    },
    {isActive: inputActive},
  );

  if (view.kind === 'download') {
    return <DownloadForm registry={registry} settings={settings} inputActive={inputActive}
      outputRoot={defaultRoot} download={download} onConfigure={onConfigure}
      onCancel={() => setView({kind: 'list'})}
      onRecord={async entry => {
        const next = await updateCatalog(loaded.revision, latest => {
          const current = latest.accessions.find(candidate => sameReference(candidate, entry));
          return withAccession(latest, {...current, ...entry, cached_copies: current?.cached_copies ?? []});
        });
        onCatalogChange(next);
        setSelected(referenceKey(entry));
        setMessage({text: `Saved metadata for ${entry.id}. Files can be downloaded later.`, variant: 'info'});
      }}
      onComplete={genome => {
        setSelected(referenceKey(genome.reference));
        setMessage(downloadMessage(genome, registry));
        setView({kind: 'list'});
        onRescan();
      }} />;
  }
  if (view.kind === 'form') {
    const editing = entries.find(entry => sameReference(entry, view.editing))!;
    return (
      <AccessionForm
        editing={editing}
        registry={registry}
        unverifiedCopies={unverifiedCopies(scan, editing)}
        inputActive={inputActive}
        progress={downloadProgress}
        message={message}
        onDownload={signal => downloadEntry(editing, signal)}
        onRefreshMetadata={registry.get(editing.source).lookupMetadata ? () => refreshMetadata(editing) : undefined}
        onCancelMetadataRefresh={() => metadataController.current?.abort()}
        onCancel={() => setView({kind: 'list'})}
        onSubmit={async entry => {
          const next = await updateCatalog(loaded.revision, latest => withLocalFields(latest, entry, localFields(entry.name ?? '', entry.description ?? '')));
          onCatalogChange(next);
          setSelected(referenceKey(entry));
          setMessage({text: `Saved ${entry.id}.`, variant: 'info'});
          setView({kind: 'list'});
        }}
      />
    );
  }

  const selectedIndex = selectedEntry ? entries.indexOf(selectedEntry) : -1;
  const damagedCopies = scan.copies.filter(copy => copy.state !== 'verified');
  const removalTargets = view.kind === 'confirm-remove'
    ? scan.copies.filter(copy => sameReference(copy, view.reference))
    : [];

  let browserShortcut = '';
  if (canView) {
    browserShortcut = browserViewShortcut;
  } else if (browser && !browser.browserAvailable) {
    browserShortcut = browserUnavailableShortcut;
  }
  return (
    <Page
      {...page}
      description={`Catalog: ${sanitizeTerminalText(catalogPath)}`}
      shortcuts={view.kind === 'confirm-remove'
        ? ['y — Remove']
        : ['Enter — Show and edit', 'n — Download new', 'd — Remove', 'r — Rescan caches', browserShortcut,
            'Tab/←/→ — Tab']}
      back={view.kind === 'confirm-remove' ? 'Keep' : 'Back'}
    >
      {notice}
      {providerNotice ? <Section title="Provider access" marginTop={0}>
        <Alert variant={providerNotice.required ? 'error' : 'warning'}>{sanitizeTerminalText(providerNotice.text)} Configure credentials in Manage tooling.</Alert>
      </Section> : null}
      {entries.length === 0 ? (
        <Alert variant={"warning"}>No genomes yet. Press n to download one; verified caches are added automatically.</Alert>
      ) : null}
      <SelectableList
        count={entries.length}
        selectedIndex={selectedIndex}
        onSelect={index => {
          setSelected(entries[index] ? referenceKey(entries[index]) : undefined);
          setMessage(undefined);
        }}
        active={inputActive && busy === undefined && view.kind === 'list'}
        height={listHeight}
        noun="accessions"
        renderItem={(index, isSelected) => {
          const entry = entries[index]!;
          return (
            <Text color={isSelected ? 'cyan' : undefined} wrap="truncate">
              {isSelected ? '› ' : '  '}
              {sanitizeTerminalText(registry.get(entry.source).label)} · {sanitizeTerminalText(accessionDisplayName(entry))}
              {entry.name ? <Text color={mutedColor}> ({entry.id})</Text> : null}
              {' · '}{cacheStatus(entry, scan)}
              {' · '}{sanitizeTerminalText(registry.get(entry.source).metadataSummary(entry.metadata))}
            </Text>
          );
        }}
      />

      {damagedCopies.length > 0 && view.kind === 'list' ? (
        <Section title="Damaged caches, not trusted">
          {damagedCopies.map(copy => (
            <Text key={copy.path} color="red" wrap="wrap">
              ✖ {sanitizeTerminalText(copy.path)} — {sanitizeTerminalText(copy.problem ?? '')}
            </Text>
          ))}
        </Section>
      ) : null}

      {scan.ignored.length > 0 && view.kind === 'list' ? (
        <Section title="Skipped in caches">
          {scan.ignored.map(entry => (
            <Text key={entry.path} color="yellow" wrap="wrap">
              – {sanitizeTerminalText(entry.path)} {sanitizeTerminalText(entry.reason)}
            </Text>
          ))}
        </Section>
      ) : null}

      {view.kind === 'confirm-remove' ? (
        <Box marginTop={1} flexDirection="column">
          <Alert variant={"warning"}>
            Remove {sanitizeTerminalText(view.reference.id)} from the catalog?
          </Alert>
          {removalTargets.length === 0 ? (
            <Alert variant={"warning"}>No cached files exist for it under the known output roots.</Alert>
          ) : (
            <>
              <Alert variant={"warning"}>
                Its cached assembly files will be deleted. A workflow that needs this accession
                will download it again.
              </Alert>
              {removalTargets.map(copy => (
                <Text key={copy.path} wrap="wrap">  {sanitizeTerminalText(copy.path)}</Text>
              ))}
            </>
          )}
        </Box>
      ) : null}

      {busy ? <Box marginTop={1}><Text>{sanitizeTerminalText(busy)}</Text></Box> : null}
      {genome.error ? <Box marginTop={1}><Text color="red" wrap="wrap">Error: {sanitizeTerminalText(genome.error)}</Text></Box> : null}
      {message ? (
        <Box marginTop={1}>
          <Alert variant={message.variant}>{sanitizeTerminalText(message.text)}</Alert>
        </Box>
      ) : null}
    </Page>
  );
}
