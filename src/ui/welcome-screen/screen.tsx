import React, {useCallback, useEffect, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text, useApp, useInput, useWindowSize} from 'ink';
import type {BuildInfo} from '../../build-info.js';
import type {ToolingStatus} from '../../tooling/check.js';
import {checkTooling} from '../../tooling/check.js';
import {
  installTooling,
  type InstallationProgress,
  type InstallationResult,
} from '../../tooling/installer.js';
import {CommandMenu} from './commands/menu.js';
import {
  moveCommandSelection,
  welcomeCommands,
  type CommandDefinition,
  type WelcomeCommandId,
} from './commands/definitions.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {NewRunScreen} from '../new-run-screen/screen.js';
import {genoPilotDetails} from '../../workflows/configuration-validation.js';
import {AccessionsScreen} from '../accessions-screen/screen.js';
import {fetchAssemblyMetadata, type AssemblyMetadataFetcher} from '../../accessions/ncbi-metadata.js';
import {loadAccessionCatalog, updateAccessionCatalog} from '../../accessions/store.js';
import type {AccessionCatalogLoader, AccessionCatalogUpdater} from '../../accessions/registration.js';
import type {CacheScanner} from '../../accessions/cache-discovery.js';
import {
  IsolatesScreen,
  type IsolateCatalogLoader,
  type IsolateCatalogUpdater,
} from '../isolates-screen/screen.js';
import {loadIsolateCatalog, updateIsolateCatalog} from '../../isolates/store.js';
import {checkReadPairs, type ReadPairsChecker} from '../../isolates/reads.js';
import {OpenRunScreen, type RunDiscovery} from '../open-run-screen/screen.js';
import {ToolingScreen} from '../tooling-screen/screen.js';
import {DocumentationScreen} from '../documentation-screen/screen.js';
import {discoverPackagedWorkflows} from '../../workflows/discovery.js';
import type {WorkflowDiscovery} from '../components/workflow-selector.js';
import {
  clearNcbiApiKey,
  isNcbiApiKeyConfigured,
  readNcbiApiKey,
  writeNcbiApiKey,
} from '../../tooling/ncbi-api-key.js';
import {resolveToolingPaths} from '../../tooling/paths.js';
import {ToolingSection} from './tooling/section.js';
import {useConfirmedExit} from './hooks/use-confirmed-exit.js';
import {useTooling} from './tooling/use-tooling.js';
import {checkForUpdate, type UpdateAvailability} from '../../self-update.js';
import {mutedColor} from '../theme.js';
import {
  HomeSuspensionContext,
  HomeSuspensionStateContext,
  useHomeSuspensions,
} from '../home-navigation.js';

export type CliMetadata = {
  packageName: string;
  label: string;
  commandName: string;
  description: string;
  author: string;
  version: string;
  license: string;
  /** The commit this build comes from, when known. */
  build?: BuildInfo;
  /** The bundled IGV version, which draws the genome views. */
  igv: string;
};

const minimumTerminalWidth = 40;
const defaultExitConfirmationMilliseconds = 2000;

/**
 * Composes the welcome-screen behaviors. Tooling, command presentation, and
 * confirmed exit are isolated so each behavior can evolve independently.
 */
export function WelcomeScreen({
  metadata,
  currentDirectory,
  toolingCheck = checkTooling,
  toolingInstaller = installTooling,
  exitConfirmationMilliseconds = defaultExitConfirmationMilliseconds,
  commands = welcomeCommands,
  workflowDiscovery,
  runDiscovery,
  onWorkflowSelected,
  ncbiApiKeyPath = resolveToolingPaths().ncbiApiKeyPath,
  checkNcbiApiKeyConfigured = () => isNcbiApiKeyConfigured(ncbiApiKeyPath),
  saveNcbiApiKey = key => writeNcbiApiKey(ncbiApiKeyPath, key),
  clearStoredNcbiApiKey = () => clearNcbiApiKey(ncbiApiKeyPath),
  isolateCatalogPath = resolveToolingPaths().isolateCatalogPath,
  loadIsolates,
  updateIsolates,
  checkIsolateReads = checkReadPairs,
  accessionCatalogPath = resolveToolingPaths().accessionCatalogPath,
  loadAccessions,
  updateAccessions,
  fetchAccessionMetadata,
  scanAccessionCaches,
  updateCheck,
  mouseReporting = false,
}: {
  metadata: CliMetadata;
  currentDirectory: string;
  toolingCheck?: () => Promise<ToolingStatus>;
  toolingInstaller?: (
    onProgress: (progress: InstallationProgress) => void,
    signal?: AbortSignal,
  ) => Promise<InstallationResult>;
  exitConfirmationMilliseconds?: number;
  commands?: readonly CommandDefinition<WelcomeCommandId>[];
  workflowDiscovery?: WorkflowDiscovery;
  runDiscovery?: RunDiscovery;
  onWorkflowSelected?: (workflowId: string) => void;
  ncbiApiKeyPath?: string;
  checkNcbiApiKeyConfigured?: () => Promise<boolean>;
  saveNcbiApiKey?: (key: string) => Promise<void>;
  clearStoredNcbiApiKey?: () => Promise<void>;
  isolateCatalogPath?: string;
  loadIsolates?: IsolateCatalogLoader;
  updateIsolates?: IsolateCatalogUpdater;
  checkIsolateReads?: ReadPairsChecker;
  accessionCatalogPath?: string;
  loadAccessions?: AccessionCatalogLoader;
  updateAccessions?: AccessionCatalogUpdater;
  fetchAccessionMetadata?: AssemblyMetadataFetcher;
  scanAccessionCaches?: CacheScanner;
  updateCheck?: (signal?: AbortSignal) => Promise<UpdateAvailability>;
  /** Whether the terminal reports the mouse, which makes plain dragging no longer select text. */
  mouseReporting?: boolean;
}): React.JSX.Element {
  const {exit} = useApp();
  const {columns} = useWindowSize();
  const tooling = useTooling({check: toolingCheck, install: toolingInstaller});
  const [selectedCommandId, setSelectedCommandId] = useState<WelcomeCommandId>(
    commands[0]?.id ?? 'new-run',
  );
  const [commandMessage, setCommandMessage] = useState<string>();
  const [activeScreenId, setActiveScreenId] = useState<WelcomeCommandId>();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>();
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string>();
  const {suspension: homeSuspension, suspend: suspendHome} = useHomeSuspensions();
  // Stable callbacks: the isolate screen reloads whenever its loader's identity changes.
  const loadIsolatesFromPath = useCallback(
    () => loadIsolateCatalog(isolateCatalogPath),
    [isolateCatalogPath],
  );
  const updateIsolatesAtPath = useCallback<IsolateCatalogUpdater>(
    (revision, mutate) => updateIsolateCatalog(isolateCatalogPath, revision, mutate),
    [isolateCatalogPath],
  );
  const loadAccessionsFromPath = useCallback(
    () => loadAccessionCatalog(accessionCatalogPath),
    [accessionCatalogPath],
  );
  const updateAccessionsAtPath = useCallback<AccessionCatalogUpdater>(
    (revision, mutate) => updateAccessionCatalog(accessionCatalogPath, revision, mutate),
    [accessionCatalogPath],
  );
  // The optional key is read for every lookup, so a key saved in this session applies at once.
  const fetchMetadataWithStoredKey = useCallback<AssemblyMetadataFetcher>(
    async accession => fetchAssemblyMetadata(accession, {apiKey: await readNcbiApiKey(ncbiApiKeyPath)}),
    [ncbiApiKeyPath],
  );

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();
    const check = updateCheck
      ?? (signal => checkForUpdate(metadata.packageName, metadata.version, undefined, signal));
    void check(abortController.signal)
      .then(result => {
        if (active) {
          setAvailableUpdateVersion(result.state === 'available' ? result.latestVersion : undefined);
        }
      })
      .catch(() => {
        // Update checks are advisory and must never block or disrupt the TUI.
        if (active) {
          setAvailableUpdateVersion(undefined);
        }
      });
    return () => {
      active = false;
      abortController.abort();
    };
  }, [metadata.packageName, metadata.version, updateCheck]);

  const finishExit = useCallback((): void => {
    tooling.cancelInstallationThen(exit);
  }, [exit, tooling.cancelInstallationThen]);
  const {showConfirmation, handleCtrlC} = useConfirmedExit({
    confirmationMilliseconds: exitConfirmationMilliseconds,
    onConfirmed: finishExit,
  });

  const activateCommand = (id: WelcomeCommandId): void => {
    switch (id) {
      case 'new-run':
      case 'open-run':
      case 'help':
      case 'manage-isolates':
      case 'manage-accessions':
        setCommandMessage(undefined);
        tooling.clearCheckMessage();
        setActiveScreenId(id);
        return;
      case 'check-tooling':
        setCommandMessage(undefined);
        tooling.clearCheckMessage();
        setActiveScreenId(id);
        return;
      default: {
        const command = commands.find(candidate => candidate.id === id);
        if (command) {
          tooling.clearCheckMessage();
          setCommandMessage(`${command.label} — Coming soon.`);
        }
      }
    }
  };

  useInput((input, key) => {
    if (input === 'c' && key.ctrl) {
      handleCtrlC();
      return;
    }

    // `h` returns home from any depth. A focused text field keeps the letter, and busy work such
    // as a running workflow must finish first, so both suspend the shortcut instead of losing it.
    if (
      activeScreenId &&
      input === 'h' &&
      !key.ctrl &&
      !key.meta &&
      !homeSuspension &&
      columns >= minimumTerminalWidth
    ) {
      tooling.clearCheckMessage();
      setActiveScreenId(undefined);
      return;
    }

    switch (activeScreenId) {
      case 'new-run':
      case 'open-run':
      case 'help':
      case 'manage-isolates':
      case 'manage-accessions':
      case 'check-tooling':
        return;
      default:
        break;
    }

    if (tooling.status.state === 'ready' && columns >= minimumTerminalWidth) {
      if (key.upArrow) {
        setSelectedCommandId(id => moveCommandSelection(commands, id, -1));
        setCommandMessage(undefined);
        tooling.clearCheckMessage();
      } else if (key.downArrow) {
        setSelectedCommandId(id => moveCommandSelection(commands, id, 1));
        setCommandMessage(undefined);
        tooling.clearCheckMessage();
      } else if (key.return) {
        activateCommand(selectedCommandId);
      }
      return;
    }

    if (tooling.status.state === 'check-failed' && input.toLowerCase() === 'r') {
      tooling.runCheck(false);
      return;
    }
    if (tooling.status.state !== 'setup-required') {
      return;
    }
    if (key.return || input.toLowerCase() === 'y') {
      tooling.startInstallation();
    } else if (input.toLowerCase() === 'n') {
      tooling.setSetupMessage('Automatic setup declined. Install the listed versions manually.');
    }
  });

  const selectWorkflow = (workflowId: string): void => {
    setSelectedWorkflowId(workflowId);
    onWorkflowSelected?.(workflowId);
  };

  const renderActiveScreen = (): React.JSX.Element => {
    switch (activeScreenId) {
      case 'new-run':
        return (
          <NewRunScreen
            onBack={() => setActiveScreenId(undefined)}
            selectedWorkflowId={selectedWorkflowId}
            onSelectedWorkflowIdChange={selectWorkflow}
            discoverWorkflows={workflowDiscovery}
            inputActive={columns >= minimumTerminalWidth}
            currentDirectory={currentDirectory}
            genopilot={genoPilotDetails(metadata.version, metadata.igv, metadata.build)}
          />
        );
      case 'open-run':
        return (
          <OpenRunScreen
            currentDirectory={currentDirectory}
            onBack={() => setActiveScreenId(undefined)}
            inputActive={columns >= minimumTerminalWidth}
            discoverWorkflows={workflowDiscovery}
            discoverRuns={runDiscovery}
          />
        );
      case 'help':
        return (
          <DocumentationScreen
            appLabel={metadata.label}
            discoverWorkflows={workflowDiscovery ?? discoverPackagedWorkflows}
            onBack={() => setActiveScreenId(undefined)}
            inputActive={columns >= minimumTerminalWidth}
          />
        );
      case 'manage-isolates':
        return (
          <IsolatesScreen
            onBack={() => setActiveScreenId(undefined)}
            inputActive={columns >= minimumTerminalWidth}
            currentDirectory={currentDirectory}
            catalogPath={isolateCatalogPath}
            loadCatalog={loadIsolates ?? loadIsolatesFromPath}
            updateCatalog={updateIsolates ?? updateIsolatesAtPath}
            checkReads={checkIsolateReads}
          />
        );
      case 'manage-accessions':
        return (
          <AccessionsScreen
            onBack={() => setActiveScreenId(undefined)}
            inputActive={columns >= minimumTerminalWidth}
            currentDirectory={currentDirectory}
            catalogPath={accessionCatalogPath}
            loadCatalog={loadAccessions ?? loadAccessionsFromPath}
            updateCatalog={updateAccessions ?? updateAccessionsAtPath}
            fetchMetadata={fetchAccessionMetadata ?? fetchMetadataWithStoredKey}
            scanCaches={scanAccessionCaches}
            checkApiKeyConfigured={checkNcbiApiKeyConfigured}
            saveApiKey={saveNcbiApiKey}
            clearApiKey={clearStoredNcbiApiKey}
            apiKeyPath={ncbiApiKeyPath}
          />
        );
      case 'check-tooling':
        return (
          <ToolingScreen
            metadata={metadata}
            status={tooling.status}
            message={tooling.checkMessage}
            onCheck={() => tooling.runCheck(true)}
            onBack={() => {
              tooling.clearCheckMessage();
              setActiveScreenId(undefined);
            }}
            inputActive={columns >= minimumTerminalWidth}
          />
        );
      default:
        return (
          <ToolingSection
            status={tooling.status}
            setupMessage={tooling.setupMessage}
            installationLogLines={tooling.installationLogLines}
          >
            <CommandMenu
              commands={commands}
              selectedId={selectedCommandId}
              message={commandMessage ?? tooling.checkMessage ?? tooling.setupMessage}
              messageVariant={commandMessage ? 'warning' : 'success'}
            />
          </ToolingSection>
        );
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderColor="cyan" borderStyle="round" flexDirection="column" paddingX={1} width="100%">
        <Text>
          <Text bold>{metadata.label}</Text>
          <Text color={mutedColor}> v{metadata.version}</Text>
        </Text>
        <Text color={mutedColor} wrap="wrap">{metadata.description}</Text>
        <Text>Ⓒ {new Date().getFullYear()} {metadata.author} · https://byteowls.com · {metadata.license}</Text>
      </Box>
      {availableUpdateVersion ? (
        <Box marginTop={1}>
          <Alert variant="warning">
            Update available: v{availableUpdateVersion} — run `{metadata.commandName} update`
          </Alert>
        </Box>
      ) : null}
      <Text color={mutedColor} wrap="wrap">
        Current directory: {sanitizeTerminalText(currentDirectory)}
      </Text>

      <Box
        display={columns < minimumTerminalWidth ? 'flex' : 'none'}
        marginTop={1}
        flexDirection="column"
      >
        <Text>This terminal is too narrow.</Text>
        <Text>Resize it to at least {minimumTerminalWidth} columns.</Text>
      </Box>
      <Box
        display={columns < minimumTerminalWidth ? 'none' : 'flex'}
        marginTop={1}
        flexDirection="column"
      >
        <HomeSuspensionContext.Provider value={suspendHome}>
          <HomeSuspensionStateContext.Provider value={homeSuspension}>
            {renderActiveScreen()}
          </HomeSuspensionStateContext.Provider>
        </HomeSuspensionContext.Provider>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {/* One line, so screens keep the rows they reserve for their content. */}
        <Text wrap="truncate-end">
          <Text color={showConfirmation ? 'yellow' : undefined}>
            {showConfirmation ? 'Press Ctrl+C again to exit.' : 'Press Ctrl+C twice to exit.'}
          </Text>
          {mouseReporting ? <Text color={mutedColor}> · Select text: Option-drag (iTerm2) or Shift-drag</Text> : null}
        </Text>
      </Box>
    </Box>
  );
}
