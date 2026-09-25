import React, {useEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text, useInput} from 'ink';
import type {DiscoveredWorkflow} from '../../workflows/discovery.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

export type WorkflowDiscovery = () => Promise<DiscoveredWorkflow[]>;

export type WorkflowDiscoveryState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; workflows: DiscoveredWorkflow[]};

export type WorkflowSelection = {
  discovery: WorkflowDiscoveryState;
  highlightedWorkflowId?: string;
  setHighlightedWorkflowId: (workflowId: string | undefined) => void;
};

/**
 * Discovers packaged workflows once and tracks the highlighted workflow by stable ID.
 *
 * Owned by the screen rather than the selector so that discovery and highlight survive while the
 * screen shows a follow-up view in place of the selector.
 *
 * @param discoverWorkflows injected workflow discovery
 * @param preferredWorkflowId workflow to highlight when discovery finds it; otherwise the first
 */
export function useWorkflowSelection(
  discoverWorkflows: WorkflowDiscovery,
  preferredWorkflowId?: string,
): WorkflowSelection {
  const initialWorkflowId = useRef(preferredWorkflowId);
  const [discovery, setDiscovery] = useState<WorkflowDiscoveryState>({state: 'loading'});
  const [highlightedWorkflowId, setHighlightedWorkflowId] = useState(preferredWorkflowId);

  useEffect(() => {
    let active = true;
    discoverWorkflows().then(
      workflows => {
        if (!active) {
          return;
        }
        setDiscovery({state: 'ready', workflows});
        setHighlightedWorkflowId(
          workflows.some(workflow => workflow.manifest.id === initialWorkflowId.current)
            ? initialWorkflowId.current
            : workflows[0]?.manifest.id,
        );
      },
      error => {
        if (active) {
          setDiscovery({
            state: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [discoverWorkflows]);

  return {discovery, highlightedWorkflowId, setHighlightedWorkflowId};
}

function moveWorkflowSelection(
  workflows: readonly DiscoveredWorkflow[],
  selectedId: string | undefined,
  offset: -1 | 1,
): string | undefined {
  if (workflows.length === 0) {
    return undefined;
  }
  const selectedIndex = workflows.findIndex(workflow => workflow.manifest.id === selectedId);
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
  return workflows[(currentIndex + offset + workflows.length) % workflows.length]?.manifest.id;
}

/** Lists discovered workflows as selectable cards and reports the chosen one. */
export function WorkflowSelector({
  selection,
  onSelect,
  onBack,
  selectHint,
  inputActive = true,
}: {
  selection: WorkflowSelection;
  onSelect: (workflow: DiscoveredWorkflow) => void;
  onBack: () => void;
  selectHint?: string;
  inputActive?: boolean;
}): React.JSX.Element {
  const {discovery, highlightedWorkflowId, setHighlightedWorkflowId} = selection;

  useInput(
    (_input, key) => {
      if (key.escape) {
        onBack();
        return;
      }
      if (discovery.state !== 'ready') {
        return;
      }
      if (key.upArrow) {
        setHighlightedWorkflowId(
          moveWorkflowSelection(discovery.workflows, highlightedWorkflowId, -1),
        );
      } else if (key.downArrow) {
        setHighlightedWorkflowId(
          moveWorkflowSelection(discovery.workflows, highlightedWorkflowId, 1),
        );
      } else if (key.return) {
        const workflow = discovery.workflows.find(
          candidate => candidate.manifest.id === highlightedWorkflowId,
        );
        if (workflow) {
          onSelect(workflow);
        }
      }
    },
    {isActive: inputActive},
  );

  const selectable = discovery.state === 'ready' && discovery.workflows.length > 0;

  return (
    <Box flexDirection="column">
      {discovery.state === 'loading' ? <Text>Discovering workflows…</Text> : null}
      {discovery.state === 'failed' ? (
        <Alert variant="error" title="Workflow discovery failed.">
          {sanitizeTerminalText(discovery.message)}
        </Alert>
      ) : null}
      {discovery.state === 'ready' && discovery.workflows.length === 0 ? (
        <Text>No packaged workflows are available.</Text>
      ) : null}
      {discovery.state === 'ready' ? discovery.workflows.map(workflow => {
        const highlighted = workflow.manifest.id === highlightedWorkflowId;
        return (
          <Box
            key={workflow.manifest.id}
            borderStyle="round"
            borderColor={highlighted ? 'cyan' : 'gray'}
            flexDirection="column"
            marginTop={1}
            paddingX={1}
          >
            <Text bold color={highlighted ? 'cyan' : undefined}>
              {highlighted ? '› ' : '  '}{sanitizeTerminalText(workflow.manifest.label)}
            </Text>
            <Text wrap="wrap">{sanitizeTerminalText(workflow.manifest.description)}</Text>
          </Box>
        );
      }) : null}
      <Box marginTop={1}>
        <Text color={mutedColor}>
          {selectable ? `↑/↓ — Select · Enter — ${selectHint ?? 'Continue'} · ` : ''}Esc — Back
        </Text>
      </Box>
    </Box>
  );
}
