import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  discoverPackagedWorkflows,
  type DiscoveredWorkflow,
} from '../../workflows/discovery.js';
import {Page} from '../components/page.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {
  useWorkflowSelection,
  WorkflowSelector,
  type WorkflowDiscovery,
} from '../components/workflow-selector.js';
import {AnnotationTransferConfigurationScreen} from './annotation-transfer-configuration.js';
import {useTerminalTitle} from '../terminal-title.js';

/** Discovers and selects a packaged workflow for a new run. */
export function NewRunScreen({
  onBack,
  selectedWorkflowId,
  onSelectedWorkflowIdChange,
  discoverWorkflows = discoverPackagedWorkflows,
  inputActive = true,
  currentDirectory,
}: {
  onBack: () => void;
  selectedWorkflowId?: string;
  onSelectedWorkflowIdChange: (workflowId: string) => void;
  discoverWorkflows?: WorkflowDiscovery;
  inputActive?: boolean;
  currentDirectory: string;
}): React.JSX.Element {
  const selection = useWorkflowSelection(discoverWorkflows, selectedWorkflowId);
  const [confirmedWorkflow, setConfirmedWorkflow] = useState<DiscoveredWorkflow>();
  useTerminalTitle({label: confirmedWorkflow?.manifest.label});

  useInput(
    (_input, key) => {
      if (key.escape) {
        setConfirmedWorkflow(undefined);
      }
    },
    {
      isActive:
        inputActive
        && confirmedWorkflow !== undefined
        && confirmedWorkflow.manifest.id !== 'annotation-transfer',
    },
  );

  if (confirmedWorkflow?.manifest.id === 'annotation-transfer') {
    return (
      <AnnotationTransferConfigurationScreen
        currentDirectory={currentDirectory}
        onBack={() => setConfirmedWorkflow(undefined)}
        inputActive={inputActive}
        parameterDefinitions={confirmedWorkflow.parameterDefinitions}
        stages={confirmedWorkflow.manifest.stages}
        manifest={confirmedWorkflow.manifest}
      />
    );
  }

  if (confirmedWorkflow) {
    return (
      <Page title="New run" detail={confirmedWorkflow.manifest.label} back="Back to workflows">
        <Text wrap="wrap">{sanitizeTerminalText(confirmedWorkflow.manifest.description)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Configuration is not available in this build.</Text>
          <Text>The workflow has not been started.</Text>
        </Box>
      </Page>
    );
  }

  return (
    <WorkflowSelector
      title="New run"
      selection={selection}
      onBack={onBack}
      onSelect={workflow => {
        setConfirmedWorkflow(workflow);
        onSelectedWorkflowIdChange(workflow.manifest.id);
      }}
      inputActive={inputActive}
    />
  );
}
