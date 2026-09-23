import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  discoverPackagedWorkflows,
  type DiscoveredWorkflow,
} from '../../workflows/discovery.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {
  useWorkflowSelection,
  WorkflowSelector,
  type WorkflowDiscovery,
} from '../workflow-selector.js';
import {AnnotationTransferConfigurationScreen} from './annotation-transfer-configuration.js';
import {mutedColor} from '../theme.js';
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

  return (
    <Box flexDirection="column">
      <Text bold>New run</Text>
      {confirmedWorkflow ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={mutedColor}>Selected workflow</Text>
          <Text bold>{sanitizeTerminalText(confirmedWorkflow.manifest.label)}</Text>
          <Text wrap="wrap">
            {sanitizeTerminalText(confirmedWorkflow.manifest.description)}
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">Configuration is not available in this build.</Text>
            <Text>The workflow has not been started.</Text>
            <Text color={mutedColor}>Esc — Back to workflows</Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text bold underline>Select a workflow</Text>
          <WorkflowSelector
            selection={selection}
            onBack={onBack}
            onSelect={workflow => {
              setConfirmedWorkflow(workflow);
              onSelectedWorkflowIdChange(workflow.manifest.id);
            }}
            inputActive={inputActive}
          />
        </Box>
      )}
    </Box>
  );
}
