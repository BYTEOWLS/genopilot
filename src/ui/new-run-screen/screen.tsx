import {fileURLToPath} from 'node:url';
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
import {ReferenceConsensusConfigurationScreen} from './reference-consensus-configuration.js';
import {useTerminalTitle} from '../terminal-title.js';
import type {GenoPilotDetails} from '../../workflows/configuration-validation.js';

type ConfigurationScreenProps = {
  currentDirectory: string;
  onBack: () => void;
  inputActive: boolean;
  genopilot: GenoPilotDetails;
  workflow: DiscoveredWorkflow;
};

function entrySnakefilePath(workflow: DiscoveredWorkflow): string {
  return fileURLToPath(new URL(workflow.manifest.entry_snakefile, workflow.directoryUrl));
}

/** The configuration screen of each workflow this build can configure, by stable workflow ID. */
const configurationScreens: Record<string, (props: ConfigurationScreenProps) => React.JSX.Element> = {
  'annotation-transfer': ({workflow, ...props}) => (
    <AnnotationTransferConfigurationScreen
      {...props}
      parameterDefinitions={workflow.parameterDefinitions}
      stages={workflow.manifest.stages}
      manifest={workflow.manifest}
      snakefilePath={entrySnakefilePath(workflow)}
    />
  ),
  'reference-consensus': ({workflow, ...props}) => (
    <ReferenceConsensusConfigurationScreen
      {...props}
      parameterDefinitions={workflow.parameterDefinitions}
      stages={workflow.manifest.stages}
      manifest={workflow.manifest}
      snakefilePath={entrySnakefilePath(workflow)}
    />
  ),
};

/** Discovers and selects a packaged workflow for a new run. */
export function NewRunScreen({
  onBack,
  selectedWorkflowId,
  onSelectedWorkflowIdChange,
  discoverWorkflows = discoverPackagedWorkflows,
  inputActive = true,
  currentDirectory,
  genopilot,
}: {
  onBack: () => void;
  selectedWorkflowId?: string;
  onSelectedWorkflowIdChange: (workflowId: string) => void;
  discoverWorkflows?: WorkflowDiscovery;
  inputActive?: boolean;
  currentDirectory: string;
  genopilot: GenoPilotDetails;
}): React.JSX.Element {
  const selection = useWorkflowSelection(discoverWorkflows, selectedWorkflowId);
  const [confirmedWorkflow, setConfirmedWorkflow] = useState<DiscoveredWorkflow>();
  useTerminalTitle({label: confirmedWorkflow?.manifest.label});
  // An own-property check, so a workflow ID such as `constructor` never resolves to Object's.
  const ConfigurationScreen = confirmedWorkflow && Object.hasOwn(configurationScreens, confirmedWorkflow.manifest.id)
    ? configurationScreens[confirmedWorkflow.manifest.id]
    : undefined;

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
        && ConfigurationScreen === undefined,
    },
  );

  if (confirmedWorkflow && ConfigurationScreen) {
    return (
      <ConfigurationScreen
        workflow={confirmedWorkflow}
        currentDirectory={currentDirectory}
        onBack={() => setConfirmedWorkflow(undefined)}
        inputActive={inputActive}
        genopilot={genopilot}
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
