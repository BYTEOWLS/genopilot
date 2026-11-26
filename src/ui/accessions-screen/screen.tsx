import React, {useCallback, useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  deleteAccessionCaches,
  emptyCacheScan,
  scanAccessionCaches,
  type AccessionCacheDeleter,
  type CacheScan,
  type CacheScanner,
} from '../../accessions/cache-discovery.js';
import {genomeSources} from '../../accessions/registry.js';
import type {GenomeProviderRegistry} from '../../accessions/provider.js';
import {providerSettings, type ProviderSettings} from '../../tooling/provider-settings.js';
import type {CatalogDownloader} from './download-form.js';

import {
  defaultOutputRoot,
  knownOutputRoots,
  refreshAccessionCaches,
  type AccessionCatalogLoader,
  type AccessionCatalogUpdater,
} from '../../accessions/registration.js';
import type {LoadedAccessionCatalog} from '../../accessions/store.js';
import type {DirectoryReader} from '../components/path-browser.js';
import {TabBar, type TabDefinition} from '../components/tabs.js';
import {Page, type PageProps} from '../components/page.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {AccessionsTab} from './accessions-tab.js';
import {RootsTab} from './roots-tab.js';
import type {accessionGenomeView} from '../../accessions/views.js';

const defaultSettings = providerSettings();

export type AccessionsTabId = 'accessions' | 'roots';

/** The shared title, detail, and tab bar each tab renders its own page with. */
export type AccessionsPageFrame = Pick<PageProps, 'title' | 'detail' | 'header'>;

const tabs: readonly TabDefinition<AccessionsTabId>[] = [
  {id: 'accessions', label: 'Accessions'},
  {id: 'roots', label: 'Output roots'},
];

type CatalogState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; loaded: LoadedAccessionCatalog; scan: CacheScan};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Saved genome identities, verified downloads, and their output roots. */
export function AccessionsScreen({
  onBack,
  inputActive,
  currentDirectory,
  catalogPath,
  loadCatalog,
  updateCatalog,
  registry = genomeSources,
  settings = defaultSettings,
  download,
  onConfigureProvider,
  scanCaches = scanAccessionCaches,
  deleteCaches = deleteAccessionCaches,
  readDirectory,
  buildGenomeView,
}: {
  onBack: () => void;
  buildGenomeView?: typeof accessionGenomeView;
  inputActive: boolean;
  currentDirectory: string;
  catalogPath: string;
  loadCatalog: AccessionCatalogLoader;
  updateCatalog: AccessionCatalogUpdater;
  registry?: GenomeProviderRegistry;
  settings?: ProviderSettings;
  download?: CatalogDownloader;
  onConfigureProvider: (source: string) => void;
  scanCaches?: CacheScanner;
  deleteCaches?: AccessionCacheDeleter;
  readDirectory?: DirectoryReader;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AccessionsTabId>('accessions');
  const [catalogState, setCatalogState] = useState<CatalogState>({state: 'loading'});
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [locks, setLocks] = useState<Readonly<Record<'accessions' | 'roots', boolean>>>({
    accessions: false,
    roots: false,
  });
  // Discovery only reads files and saves atomically, so leaving mid-scan is safe; only open forms
  // and running edits hold the tab bar and Esc.
  const locked = locks[activeTab];

  const rescan = useCallback((): void => {
    setScanning(true);
    setScanError(undefined);
    // Show the saved catalog at once; verifying its caches can take a while for large assemblies,
    // and the list is only read-only until it finishes.
    loadCatalog().then(
      loaded => {
        setCatalogState(current => current.state === 'ready'
          ? {...current, loaded}
          : {state: 'ready', loaded, scan: emptyCacheScan()});
        return refreshAccessionCaches({currentDirectory, loadCatalog, updateCatalog, scanCaches}).then(
          ({loaded: refreshed, scan}) => {
            setCatalogState({state: 'ready', loaded: refreshed, scan});
            setScanning(false);
          },
          error => {
            setScanError(errorMessage(error));
            setScanning(false);
          },
        );
      },
      error => {
        // A catalog that cannot be read is shown as such; a later rescan keeps the last good one.
        setCatalogState(current => current.state === 'ready'
          ? current
          : {state: 'failed', message: errorMessage(error)});
        setScanError(errorMessage(error));
        setScanning(false);
      },
    );
  }, [currentDirectory, loadCatalog, updateCatalog, scanCaches]);

  useEffect(rescan, [rescan]);

  const lockAccessions = useCallback((value: boolean) => setLocks(current => ({...current, accessions: value})), []);
  const lockRoots = useCallback((value: boolean) => setLocks(current => ({...current, roots: value})), []);
  const setLoaded = useCallback((loaded: LoadedAccessionCatalog): void => {
    setCatalogState(current => current.state === 'ready' ? {...current, loaded} : current);
  }, []);

  useInput(
    (_input, key) => {
      if (!locked && key.escape) {
        onBack();
      }
    },
    {isActive: inputActive},
  );

  const ready = catalogState.state === 'ready' ? catalogState : undefined;
  const roots = ready ? knownOutputRoots(ready.loaded.catalog, currentDirectory) : [];
  const tabBar = (
    <TabBar
      tabs={tabs}
      activeId={activeTab}
      onChange={setActiveTab}
      inputActive={inputActive && !locked}
    />
  );
  // Every tab renders its own page under the same title; only the active one carries the tab bar,
  // so its keys are handled once.
  const frameFor = (tab: AccessionsTabId): AccessionsPageFrame => ({
    title: 'Genome catalog',
    detail: [
      ready ? `${String(ready.loaded.catalog.accessions.length)} in catalog` : undefined,
      scanning && ready ? 'verifying caches…' : undefined,
    ].filter(Boolean).join(' · ') || undefined,
    ...(tab === activeTab ? {header: tabBar} : {}),
  });
  const notice = scanError ? (
    <Text color="red" wrap="wrap">Error: {sanitizeTerminalText(scanError)}</Text>
  ) : undefined;

  return (
    <Box flexDirection="column">
      {!ready ? (
        <Page {...frameFor(activeTab)} description={`Catalog: ${sanitizeTerminalText(catalogPath)}`}>
          {catalogState.state === 'failed' ? (
            <Box flexDirection="column">
              <Text color="red">Unable to load the accession catalog.</Text>
              <Text wrap="wrap">{sanitizeTerminalText(catalogState.message)}</Text>
            </Box>
          ) : (
            <Text>Discovering cached accessions…</Text>
          )}
        </Page>
      ) : null}
      {/* Inactive tabs stay mounted so switching keeps their selection and messages. */}
      {ready ? (
        <Box flexDirection="column" display={activeTab === 'accessions' ? 'flex' : 'none'}>
          <AccessionsTab
            page={frameFor('accessions')}
            catalogPath={catalogPath}
            notice={notice}
            loaded={ready.loaded}
            scan={ready.scan}
            roots={roots}
            inputActive={inputActive && activeTab === 'accessions'}
            verifying={scanning}
            updateCatalog={updateCatalog}
            registry={registry}
            settings={settings}
            download={download}
            onConfigure={onConfigureProvider}
            defaultRoot={defaultOutputRoot(currentDirectory)}
            deleteCaches={deleteCaches}
            onCatalogChange={setLoaded}
            onRescan={rescan}
            onLockChange={lockAccessions}
            buildGenomeView={buildGenomeView}
          />
        </Box>
      ) : null}
      {ready ? (
        <Box flexDirection="column" display={activeTab === 'roots' ? 'flex' : 'none'}>
          <RootsTab
            page={frameFor('roots')}
            notice={notice}
            loaded={ready.loaded}
            scan={ready.scan}
            defaultRoot={defaultOutputRoot(currentDirectory)}
            currentDirectory={currentDirectory}
            inputActive={inputActive && activeTab === 'roots'}
            verifying={scanning}
            updateCatalog={updateCatalog}
            readDirectory={readDirectory}
            onCatalogChange={loaded => {
              setLoaded(loaded);
              rescan();
            }}
            onLockChange={lockRoots}
          />
        </Box>
      ) : null}
    </Box>
  );
}
