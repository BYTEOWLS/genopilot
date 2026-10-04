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
import type {AssemblyMetadataFetcher} from '../../accessions/ncbi-metadata.js';
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
import {
  ApiKeyTab,
  type NcbiAccessStatusCheck,
  type NcbiApiKeyClearer,
  type NcbiApiKeySaver,
} from './api-key-tab.js';
import {RootsTab} from './roots-tab.js';
import type {accessionGenomeView} from '../../accessions/views.js';

export type AccessionsTabId = 'accessions' | 'roots' | 'api-key';

/** The shared title, detail, and tab bar each tab renders its own page with. */
export type AccessionsPageFrame = Pick<PageProps, 'title' | 'detail' | 'header'>;

const tabs: readonly TabDefinition<AccessionsTabId>[] = [
  {id: 'accessions', label: 'Accessions'},
  {id: 'roots', label: 'Output roots'},
  {id: 'api-key', label: 'NCBI API key'},
];

type CatalogState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; loaded: LoadedAccessionCatalog; scan: CacheScan};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Manages the accession catalog, the output roots its caches are discovered in, and the optional
 * NCBI API key. Opening the screen discovers verified caches; it never downloads or deletes
 * assembly files except when the researcher removes an entry.
 */
export function AccessionsScreen({
  onBack,
  inputActive,
  currentDirectory,
  catalogPath,
  loadCatalog,
  updateCatalog,
  fetchMetadata,
  scanCaches = scanAccessionCaches,
  deleteCaches = deleteAccessionCaches,
  readDirectory,
  checkApiKeyConfigured,
  saveApiKey,
  clearApiKey,
  apiKeyPath,
  buildGenomeView,
}: {
  onBack: () => void;
  buildGenomeView?: typeof accessionGenomeView;
  inputActive: boolean;
  currentDirectory: string;
  catalogPath: string;
  loadCatalog: AccessionCatalogLoader;
  updateCatalog: AccessionCatalogUpdater;
  fetchMetadata: AssemblyMetadataFetcher;
  scanCaches?: CacheScanner;
  deleteCaches?: AccessionCacheDeleter;
  readDirectory?: DirectoryReader;
  checkApiKeyConfigured?: NcbiAccessStatusCheck;
  saveApiKey: NcbiApiKeySaver;
  clearApiKey: NcbiApiKeyClearer;
  apiKeyPath?: string;
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
  const locked = activeTab !== 'api-key' && locks[activeTab];
  // While the key field holds a draft, ←/→ move its cursor instead of switching tabs.
  const [apiKeyDraft, setApiKeyDraft] = useState(false);

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
      arrowKeys={!(activeTab === 'api-key' && apiKeyDraft)}
    />
  );
  // Every tab renders its own page under the same title; only the active one carries the tab bar,
  // so its keys are handled once.
  const frameFor = (tab: AccessionsTabId): AccessionsPageFrame => ({
    title: 'NCBI accessions',
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
      {!ready && activeTab !== 'api-key' ? (
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
            fetchMetadata={fetchMetadata}
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
      <Box flexDirection="column" display={activeTab === 'api-key' ? 'flex' : 'none'}>
        <ApiKeyTab
          page={frameFor('api-key')}
          inputActive={inputActive && activeTab === 'api-key'}
          checkConfigured={checkApiKeyConfigured}
          saveKey={saveApiKey}
          clearKey={clearApiKey}
          keyPath={apiKeyPath}
          onDraftChange={setApiKeyDraft}
        />
      </Box>
    </Box>
  );
}
