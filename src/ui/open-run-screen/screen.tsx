import {resolve} from 'node:path';
import React, {useState} from 'react';
import {Alert, ConfirmInput} from '@inkjs/ui';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {
  discoverPackagedWorkflows,
  type DiscoveredWorkflow,
} from '../../workflows/discovery.js';
import {
  deleteWorkflowRun,
  discoverWorkflowRuns,
  type DiscoveredRun,
} from '../../workflows/run-discovery.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {RunResultsScreen} from '../run-results-screen/screen.js';
import {formatLocalDateTime} from '../utils.js';
import {
  useWorkflowSelection,
  WorkflowSelector,
  type WorkflowDiscovery,
} from '../components/workflow-selector.js';
import {mutedColor} from '../theme.js';
import {useTerminalTitle} from '../terminal-title.js';
import {useHomeSuspension} from '../home-navigation.js';

export type RunDiscovery = (
  collectionRoot: string,
  workflow: DiscoveredWorkflow,
) => Promise<DiscoveredRun[]>;

export type RunDeletion = (runDirectory: string) => Promise<void>;

type RunState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; runs: DiscoveredRun[]};

type DeletionState =
  | {state: 'confirm'; run: DiscoveredRun}
  | {state: 'deleting'; run: DiscoveredRun}
  | {state: 'failed'; run: DiscoveredRun; message: string};

function moveSelection<T>(
  values: readonly T[],
  selectedIndex: number,
  offset: -1 | 1,
): number {
  if (values.length === 0) {
    return 0;
  }
  return (selectedIndex + offset + values.length) % values.length;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function RunStatus({run}: {run: DiscoveredRun}): React.JSX.Element {
  switch (run.status) {
    case 'completed':
      return <Alert variant="success">Status: Completed</Alert>;
    case 'completed-with-warnings':
      return <Alert variant="success">Completed with warnings</Alert>;
    case 'validation-failed':
      return <Alert variant="error">Validation failed</Alert>;
    case 'incomplete':
      return <Alert variant="warning">Incomplete or process failed (summary missing)</Alert>;
    case 'corrupt':
      return <Alert variant="error">Saved result is corrupt</Alert>;
    case 'incompatible':
      return <Alert variant="error">Unsupported or incompatible saved result</Alert>;
  }
}

/** Selects and opens a persisted run without invoking Snakemake. */
export function OpenRunScreen({
  currentDirectory,
  onBack,
  inputActive = true,
  discoverWorkflows = discoverPackagedWorkflows,
  discoverRuns = (collectionRoot, workflow) =>
    discoverWorkflowRuns(collectionRoot, workflow.manifest),
  deleteRun,
  formatDateTime = formatLocalDateTime,
}: {
  currentDirectory: string;
  onBack: () => void;
  inputActive?: boolean;
  discoverWorkflows?: WorkflowDiscovery;
  discoverRuns?: RunDiscovery;
  deleteRun?: RunDeletion;
  formatDateTime?: (value: string) => string;
}): React.JSX.Element {
  const {rows: terminalRows} = useWindowSize();
  const collectionRoot = resolve(currentDirectory, 'runs');
  const workflowSelection = useWorkflowSelection(discoverWorkflows);
  const [selectedWorkflow, setSelectedWorkflow] = useState<DiscoveredWorkflow>();
  useTerminalTitle({label: selectedWorkflow?.manifest.label});
  const [runState, setRunState] = useState<RunState>();
  const [runIndex, setRunIndex] = useState(0);
  const [openedRun, setOpenedRun] = useState<DiscoveredRun>();
  const [deletionState, setDeletionState] = useState<DeletionState>();
  useHomeSuspension(deletionState?.state === 'deleting' ? 'busy' : undefined);

  const openWorkflow = async (workflow: DiscoveredWorkflow): Promise<void> => {
    setSelectedWorkflow(workflow);
    setRunState({state: 'loading'});
    try {
      const runs = await discoverRuns(collectionRoot, workflow);
      setRunIndex(0);
      setRunState({state: 'ready', runs});
    } catch (error) {
      setRunState({state: 'failed', message: detail(error)});
    }
  };

  const confirmDeletion = async (run: DiscoveredRun): Promise<void> => {
    setDeletionState({state: 'deleting', run});
    try {
      if (deleteRun) {
        await deleteRun(run.directory);
      } else {
        if (!collectionRoot || !selectedWorkflow) {
          throw new Error('The selected workflow run directory is unavailable.');
        }
        await deleteWorkflowRun(collectionRoot, selectedWorkflow.manifest.id, run.directory);
      }
      setRunState(current => {
        if (current?.state !== 'ready') {
          return current;
        }
        return {state: 'ready', runs: current.runs.filter(candidate => candidate.directory !== run.directory)};
      });
      setRunIndex(index => Math.max(0, index - 1));
      setDeletionState(undefined);
    } catch (error) {
      setDeletionState({state: 'failed', run, message: detail(error)});
    }
  };

  useInput((input, key) => {
    if (!inputActive || openedRun || !selectedWorkflow) {
      return;
    }
    if (deletionState) {
      if (deletionState.state === 'failed' && key.escape) {
        setDeletionState(undefined);
      }
      return;
    }
    if (key.escape) {
      setSelectedWorkflow(undefined);
      setRunState(undefined);
      return;
    }
    if (runState?.state !== 'ready') {
      return;
    }
    if (key.upArrow) {
      setRunIndex(index => moveSelection(runState.runs, index, -1));
    } else if (key.downArrow) {
      setRunIndex(index => moveSelection(runState.runs, index, 1));
    } else if (key.return) {
      const run = runState.runs[runIndex];
      if (run) {
        setOpenedRun(run);
      }
    } else if (input.toLowerCase() === 'd') {
      const run = runState.runs[runIndex];
      if (run) {
        setDeletionState({state: 'confirm', run});
      }
    }
  });

  const visibleRunCount = Math.max(
    1,
    Math.floor((terminalRows - (deletionState ? 14 : 8)) / 8),
  );
  const visibleRunStart = runState?.state === 'ready'
    ? Math.max(0, Math.min(
        runIndex - Math.floor(visibleRunCount / 2),
        runState.runs.length - visibleRunCount,
      ))
    : 0;
  const visibleRuns = runState?.state === 'ready'
    ? runState.runs.slice(visibleRunStart, visibleRunStart + visibleRunCount)
    : [];

  if (openedRun && selectedWorkflow) {
    return (
      <RunResultsScreen
        runDirectory={openedRun.directory}
        manifest={selectedWorkflow.manifest}
        loaded={openedRun.loaded}
        runMetadata={openedRun.metadata}
        formatDateTime={formatDateTime}
        onBack={() => setOpenedRun(undefined)}
        inputActive={inputActive}
      />
    );
  }

  if (!selectedWorkflow) {
    return (
      <Box flexDirection="column">
        <Text bold underline>Open existing run</Text>
        <WorkflowSelector
          selection={workflowSelection}
          onBack={onBack}
          onSelect={workflow => void openWorkflow(workflow)}
          inputActive={inputActive}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold underline>Open existing run</Text>
      <Box marginTop={1} flexDirection="column" marginBottom={1}>
        <Text>
          Workflow: {sanitizeTerminalText(selectedWorkflow.manifest.label)}
        </Text>
        <Text color={mutedColor}>Run directory: {sanitizeTerminalText(collectionRoot)}</Text>
      </Box>

      {runState?.state === 'loading' && (
          <Text>Discovering runs…</Text>
      )}
      {runState?.state === 'failed' && (
        <Alert variant="error">{sanitizeTerminalText(runState.message)}</Alert>
      )}
      {runState?.state === 'ready' && runState.runs.length === 0 && (
        <Alert variant="warning">No runs were found for this workflow.</Alert>
      )}
      {runState?.state === 'ready' ? visibleRuns.map((run, visibleIndex) => {
        const index = visibleRunStart + visibleIndex;
        return (
          <Box
            key={run.directory}
            borderStyle="round"
            borderColor={index === runIndex ? 'cyan' : 'gray'}
            flexDirection="column"
            marginTop={1}
            paddingX={1}
          >
            <Text bold color={index === runIndex ? 'cyan' : undefined}>
              {index === runIndex ? '› ' : '  '}{sanitizeTerminalText(run.metadata.name ?? 'Unnamed run')}
            </Text>
            {run.metadata.description && (
              <Text wrap="truncate">Description: {sanitizeTerminalText(run.metadata.description)}</Text>
            )}
            <Text>
              Created: {run.metadata.createdAt
                ? formatDateTime(run.metadata.createdAt)
                : 'Unavailable'}
            </Text>
            <RunStatus run={run} />
            {run.missingLinkedPaths > 0 && (
              <Alert variant="warning">
                {String(run.missingLinkedPaths)} linked path{run.missingLinkedPaths === 1 ? ' is' : 's are'} missing
              </Alert>
            )}

            {deletionState?.run.directory === run.directory && (
              <>
                {deletionState.state === 'confirm' && (
                  <Alert variant="warning">
                    Permanently delete this run and all its files? <ConfirmInput
                      isDisabled={!inputActive}
                      defaultChoice="cancel"
                      submitOnEnter={false}
                      onConfirm={() => void confirmDeletion(run)}
                      onCancel={() => setDeletionState(undefined)}
                    />
                  </Alert>
                )}
                {deletionState.state === 'deleting' && (<Text>Deleting run…</Text> )}
                {deletionState.state === 'failed' && (
                  <Alert variant="error">Could not delete run: {sanitizeTerminalText(deletionState.message)}</Alert>
                )}
              </>
            )}
          </Box>
        );
      }) : null}
      {runState?.state === 'ready' && runState.runs.length > visibleRunCount && (
        <Text color={mutedColor}>{runIndex + 1} of {runState.runs.length}</Text>
      )}
      <Text color={mutedColor}>↑/↓ — Select · Enter — Open results · d — Delete · Esc — Back to workflows</Text>
    </Box>
  );
}
