import React, {useCallback, useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {childIsolateIds, type Isolate} from '../../isolates/catalog.js';
import type {ReadPairsCheck, ReadPairsChecker} from '../../isolates/reads.js';
import type {IsolateCatalogMutation, LoadedIsolateCatalog} from '../../isolates/store.js';
import type {DirectoryReader} from '../new-run-screen/path-browser.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {IsolateForm, withIsolate} from './isolate-form.js';

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
  | {kind: 'confirm-remove'; id: string};

const visibleIsolateCount = 10;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSummary(isolate: Isolate, check: ReadPairsCheck | undefined): string {
  const count = isolate.read_pairs.length;
  const pairs = `${String(count)} read pair${count === 1 ? '' : 's'}`;
  const trimmedCount = isolate.read_pairs.filter(pair => pair.trimmed).length;
  const trimmed = trimmedCount === 0 ? '' : trimmedCount === count ? ', trimmed' : ', partly trimmed';
  if (!check) {
    return `${pairs}${trimmed} · checking reads`;
  }
  const problems = check.pairs.flatMap((pair, index) => [
    pair.r1.state === 'ok' ? undefined : `pair ${String(index + 1)} R1 ${pair.r1.state}`,
    pair.r2.state === 'ok' ? undefined : `pair ${String(index + 1)} R2 ${pair.r2.state}`,
  ]).filter((problem): problem is string => problem !== undefined);
  if (check.sameFiles.length > 0) {
    problems.push('linked duplicate files');
  }
  return `${pairs}${trimmed} · ${problems.length === 0 ? 'reads ok' : `reads: ${problems.join(', ')}`}`;
}

function lineage(isolate: Isolate): string {
  const wildtype = isolate.wildtype === null
    ? 'wild type not recorded'
    : isolate.wildtype ? 'wild type' : 'not wild type';
  return isolate.derived_from === null ? wildtype : `${wildtype}, derived from ${isolate.derived_from}`;
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
}: {
  onBack: () => void;
  inputActive: boolean;
  currentDirectory: string;
  catalogPath: string;
  loadCatalog: IsolateCatalogLoader;
  updateCatalog: IsolateCatalogUpdater;
  checkReads: ReadPairsChecker;
  readDirectory?: DirectoryReader;
}): React.JSX.Element {
  const [catalogState, setCatalogState] = useState<CatalogState>({state: 'loading'});
  const [readChecks, setReadChecks] = useState<ReadonlyMap<string, ReadPairsCheck>>(new Map());
  const [view, setView] = useState<View>({kind: 'list'});
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState<{text: string; error: boolean}>();
  const [busy, setBusy] = useState(false);
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
  useEffect(() => {
    if (!isolates) {
      return;
    }
    let active = true;
    setReadChecks(new Map());
    for (const isolate of isolates) {
      checkReads(isolate.read_pairs).then(
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
      if (busy || view.kind === 'form') {
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
      const {isolates: current} = catalogState.loaded.catalog;
      if (input === 'n') {
        setMessage(undefined);
        setView({kind: 'form'});
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

  const selectedIndex = isolates?.findIndex(isolate => isolate.id === selectedId) ?? -1;
  const visibleStart = isolates
    ? Math.max(0, Math.min(selectedIndex - Math.floor(visibleIsolateCount / 2), isolates.length - visibleIsolateCount))
    : 0;

  return (
    <Box flexDirection="column">
      <Text bold underline>Isolates</Text>
      <Text color={mutedColor} wrap="truncate">Catalog: {sanitizeTerminalText(catalogPath)}</Text>
      <Box marginTop={1} flexDirection="column">
        {catalogState.state === 'loading' ? <Text>Loading isolates…</Text> : null}
        {catalogState.state === 'failed' ? (
          <Box flexDirection="column">
            <Text color="red">Unable to load the isolate catalog.</Text>
            <Text wrap="wrap">{sanitizeTerminalText(catalogState.message)}</Text>
          </Box>
        ) : null}
        {isolates && isolates.length === 0 ? (
          <Text>No isolates yet. Press n to add one.</Text>
        ) : null}
        {isolates?.slice(visibleStart, visibleStart + visibleIsolateCount).map(isolate => {
          const isSelected = isolate.id === selectedId;
          return (
            <Text key={isolate.id} color={isSelected ? 'cyan' : undefined} wrap="truncate">
              {isSelected ? '› ' : '  '}
              {sanitizeTerminalText(isolate.name)}
              <Text color={mutedColor}> ({sanitizeTerminalText(isolate.id)})</Text>
              {/* Read problems come before lineage so a narrow terminal truncates the less urgent part. */}
              {' · '}{readSummary(isolate, readChecks.get(isolate.id))}
              {' · '}{sanitizeTerminalText(lineage(isolate))}
            </Text>
          );
        })}
        {isolates && isolates.length > visibleIsolateCount ? (
          <Text color={mutedColor}>{selectedIndex + 1} of {isolates.length}</Text>
        ) : null}
      </Box>
      {view.kind === 'confirm-remove' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" wrap="wrap">
            Remove isolate {sanitizeTerminalText(view.id)} from the catalog? Its read files are not
            deleted.
          </Text>
          <Text>{busy ? 'Removing…' : 'y — Remove · n/Esc — Keep'}</Text>
        </Box>
      ) : null}
      {message ? (
        <Box marginTop={1}>
          <Text color={message.error ? 'red' : undefined} wrap="wrap">
            {message.error ? 'Error: ' : ''}{sanitizeTerminalText(message.text)}
          </Text>
        </Box>
      ) : null}
      {view.kind === 'list' ? (
        <Box marginTop={1}>
          <Text color={mutedColor} wrap="wrap">
            ↑/↓ — Select · Enter — Edit · n — New · d — Remove · r — Reload · Esc — Back
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
