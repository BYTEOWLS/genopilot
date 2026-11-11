import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import {childIsolateIds, readPairs, type Isolate} from '../../isolates/catalog.js';
import type {ReadPairsCheck, ReadPairsChecker} from '../../isolates/reads.js';
import {isolateListLineage, isolateTechnique, readSummary} from '../../isolates/presentation.js';
import type {IsolateCatalogMutation, LoadedIsolateCatalog} from '../../isolates/store.js';
import type {DirectoryReader} from '../components/path-browser.js';
import {useHomeSuspension} from '../home-navigation.js';
import {Page} from '../components/page.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {scanIlluminaDelivery} from '../../isolates/illumina/delivery.js';
import {IsolateImport, type DeliveryScanner} from './import.js';
import {IsolateForm, withIsolate} from './isolate-form.js';
import {isolateDocumentNames, readGeneralDocuments, type DocumentsLoader} from '../../docs/documents.js';
import {MarkdownDocumentPage} from '../components/markdown-document-page.js';

export type IsolateCatalogLoader = () => Promise<LoadedIsolateCatalog>;
export type IsolateCatalogUpdater = (
  expectedRevision: string | undefined,
  mutate: IsolateCatalogMutation,
) => Promise<LoadedIsolateCatalog>;

type CatalogState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; loaded: LoadedIsolateCatalog};

type View =
  | {kind: 'list'}
  | {kind: 'form'; editingId?: string}
  | {kind: 'import'}
  | {kind: 'confirm-remove'; id: string};

const visibleIsolateCount = 10;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function IsolatesScreen({
  onBack,
  inputActive,
  currentDirectory,
  catalogPath,
  loadCatalog,
  updateCatalog,
  checkReads,
  readDirectory,
  scanDelivery = scanIlluminaDelivery,
  loadHelp = () => readGeneralDocuments(isolateDocumentNames),
}: {
  onBack: () => void;
  inputActive: boolean;
  currentDirectory: string;
  catalogPath: string;
  loadCatalog: IsolateCatalogLoader;
  updateCatalog: IsolateCatalogUpdater;
  checkReads: ReadPairsChecker;
  readDirectory?: DirectoryReader;
  scanDelivery?: DeliveryScanner;
  loadHelp?: DocumentsLoader;
}): React.JSX.Element {
  const [catalogState, setCatalogState] = useState<CatalogState>({state: 'loading'});
  const [readChecks, setReadChecks] = useState<ReadonlyMap<string, ReadPairsCheck>>(new Map());
  const [view, setView] = useState<View>({kind: 'list'});
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState<{text: string; error: boolean}>();
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  useHomeSuspension(busy ? 'busy' : undefined);

  const applyLoaded = useCallback((loaded: LoadedIsolateCatalog): void => {
    setCatalogState({state: 'ready', loaded});
    setSelectedId(current =>
      loaded.catalog.isolates.some(isolate => isolate.id === current)
        ? current
        : loaded.catalog.isolates[0]?.id,
    );
  }, []);

  const reload = useCallback((): void => {
    setCatalogState({state: 'loading'});
    loadCatalog().then(applyLoaded, error => setCatalogState({state: 'failed', message: errorMessage(error)}));
  }, [applyLoaded, loadCatalog]);

  useEffect(reload, [reload]);

  // Re-check every isolate's reads whenever the catalog changes; files may have moved since the
  // isolate was saved, and that must be visible before a run selects it.
  const isolates = catalogState.state === 'ready' ? catalogState.loaded.catalog.isolates : undefined;
  const techniqueGroups = useMemo(() => {
    const groups = new Map<string, Isolate[]>();
    for (const isolate of isolates ?? []) {
      const technique = isolateTechnique(isolate);
      const group = groups.get(technique);
      if (group) {
        group.push(isolate);
      } else {
        groups.set(technique, [isolate]);
      }
    }
    return [...groups].map(([technique, entries]) => ({technique, isolates: entries}));
  }, [isolates]);
  const orderedIsolates = techniqueGroups.flatMap(group => group.isolates);
  useEffect(() => {
    if (!isolates) {
      return;
    }
    let active = true;
    setReadChecks(new Map());
    for (const isolate of isolates) {
      checkReads(readPairs(isolate)).then(
        check => {
          if (active) {
            setReadChecks(current => new Map(current).set(isolate.id, check));
          }
        },
        () => undefined,
      );
    }
    return () => {
      active = false;
    };
  }, [checkReads, isolates]);

  const removeIsolate = (revision: string | undefined, id: string): void => {
    setBusy(true);
    updateCatalog(revision, catalog => ({
      ...catalog,
      isolates: catalog.isolates.filter(isolate => isolate.id !== id),
    })).then(
      loaded => {
        applyLoaded(loaded);
        setMessage({text: `Removed isolate ${id}.`, error: false});
        setView({kind: 'list'});
        setBusy(false);
      },
      error => {
        setMessage({text: errorMessage(error), error: true});
        setView({kind: 'list'});
        setBusy(false);
      },
    );
  };

  useInput(
    (input, key) => {
      if (busy || showHelp || view.kind === 'form' || view.kind === 'import') {
        return;
      }
      if (view.kind === 'confirm-remove') {
        if (input.toLowerCase() === 'y' && catalogState.state === 'ready') {
          removeIsolate(catalogState.loaded.revision, view.id);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          setView({kind: 'list'});
        }
        return;
      }
      if (input === '?') {
        setShowHelp(true);
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
      if (input === 'r') {
        setMessage(undefined);
        reload();
        return;
      }
      if (catalogState.state !== 'ready') {
        return;
      }
      const current = orderedIsolates;
      if (input === 'n') {
        setMessage(undefined);
        setView({kind: 'form'});
        return;
      }
      if (input === 'i') {
        setMessage(undefined);
        setView({kind: 'import'});
        return;
      }
      if (current.length === 0 || selectedId === undefined) {
        return;
      }
      if (key.upArrow || key.downArrow) {
        const index = Math.max(0, current.findIndex(isolate => isolate.id === selectedId));
        const offset = key.upArrow ? -1 : 1;
        setSelectedId(current[(index + offset + current.length) % current.length]?.id);
        setMessage(undefined);
      } else if (key.return) {
        setMessage(undefined);
        setView({kind: 'form', editingId: selectedId});
      } else if (input === 'd') {
        const children = childIsolateIds(catalogState.loaded.catalog, selectedId);
        if (children.length > 0) {
          setMessage({
            text:
              `Isolate ${selectedId} cannot be removed while ${children.join(', ')} ` +
              `${children.length === 1 ? 'is' : 'are'} derived from it. Change their lineage first.`,
            error: true,
          });
        } else {
          setMessage(undefined);
          setView({kind: 'confirm-remove', id: selectedId});
        }
      }
    },
    {isActive: inputActive},
  );

  if (showHelp) {
    return <MarkdownDocumentPage title="Managing isolates" load={loadHelp}
      onClose={() => setShowHelp(false)} back="Close help" inputActive={inputActive} />;
  }

  if (view.kind === 'form' && catalogState.state === 'ready') {
    const {catalog} = catalogState.loaded;
    const editing = catalog.isolates.find(isolate => isolate.id === view.editingId);
    return (
      <IsolateForm
        key={view.editingId ?? 'new'}
        catalog={catalog}
        editing={editing}
        checkReads={checkReads}
        inputActive={inputActive}
        currentDirectory={currentDirectory}
        readDirectory={readDirectory}
        loadHelp={loadHelp}
        onCancel={() => setView({kind: 'list'})}
        onSubmit={async isolate => {
          const loaded = await updateCatalog(
            catalogState.loaded.revision,
            latest => withIsolate(latest, isolate, editing?.id),
          );
          applyLoaded(loaded);
          setSelectedId(isolate.id);
          setMessage({text: `Saved isolate ${isolate.id}.`, error: false});
          setView({kind: 'list'});
        }}
      />
    );
  }

  if (view.kind === 'import' && catalogState.state === 'ready') {
    return (
      <IsolateImport
        loaded={catalogState.loaded}
        loadCatalog={loadCatalog}
        updateCatalog={updateCatalog}
        checkReads={checkReads}
        scanDelivery={scanDelivery}
        inputActive={inputActive}
        currentDirectory={currentDirectory}
        readDirectory={readDirectory}
        onCancel={() => setView({kind: 'list'})}
        onDone={(loaded, text) => {
          applyLoaded(loaded);
          setMessage({text, error: false});
          setView({kind: 'list'});
        }}
      />
    );
  }

  const selectedIndex = orderedIsolates.findIndex(isolate => isolate.id === selectedId);
  const visibleStart = Math.max(0, Math.min(selectedIndex - Math.floor(visibleIsolateCount / 2), orderedIsolates.length - visibleIsolateCount));
  const visibleIds = new Set(orderedIsolates.slice(visibleStart, visibleStart + visibleIsolateCount).map(isolate => isolate.id));

  return (
    <Page
      title="Isolates"
      detail={isolates ? `${String(isolates.length)} in catalog` : undefined}
      description={`Catalog: ${sanitizeTerminalText(catalogPath)}`}
      shortcuts={view.kind === 'confirm-remove'
        ? [busy ? 'Removing…' : 'y — Remove']
        : ['↑/↓ — Select', 'Enter — Edit', 'n — New', 'i — Import delivery', 'd — Remove', 'r — Reload', '? — Help']}
      back={view.kind === 'confirm-remove' ? 'Keep' : 'Back'}
    >
      {catalogState.state === 'loading' ? <Text>Loading isolates…</Text> : null}
      {catalogState.state === 'failed' ? (
        <Box flexDirection="column">
          <Text color="red">Unable to load the isolate catalog.</Text>
          <Text wrap="wrap">{sanitizeTerminalText(catalogState.message)}</Text>
        </Box>
      ) : null}
      {isolates && isolates.length === 0 ? (
        <Alert variant="warning">No isolates yet. Press n to add one or i to import a sequencing delivery.</Alert>
      ) : null}
      {techniqueGroups.map(group => {
        const visible = group.isolates.filter(isolate => visibleIds.has(isolate.id));
        if (visible.length === 0) {
          return null;
        }
        return <Box key={group.technique} flexDirection="column" marginBottom={1}>
          <Text bold underline wrap="truncate">{sanitizeTerminalText(group.technique)} · {group.isolates.length}</Text>
          {visible.map(isolate => {
            const isSelected = isolate.id === selectedId;
            const lineage = isolateListLineage(isolate);
            return <Text key={isolate.id} color={isSelected ? 'cyan' : undefined} wrap="truncate">
              {isSelected ? '› ' : '  '}
              {sanitizeTerminalText(isolate.name)}
              <Text color={mutedColor}> ({sanitizeTerminalText(isolate.id)})</Text>
              {' · '}{readSummary(isolate, readChecks.get(isolate.id))}
              {lineage ? ` · ${sanitizeTerminalText(lineage)}` : ''}
            </Text>;
          })}
        </Box>;
      })}
      {isolates && isolates.length > visibleIsolateCount ? (
        <Text color={mutedColor}>{selectedIndex + 1} of {isolates.length}</Text>
      ) : null}
      {view.kind === 'confirm-remove' ? (
        <Box marginTop={1}>
          <Text color="yellow" wrap="wrap">
            Remove isolate {sanitizeTerminalText(view.id)} from the catalog? Its read files are not
            deleted.
          </Text>
        </Box>
      ) : null}
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
