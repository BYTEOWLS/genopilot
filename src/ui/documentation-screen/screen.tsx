import React, {useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text, useInput} from 'ink';
import {
  generalDocumentNames,
  readGeneralDocuments,
  readWorkflowDocuments,
  type DocumentsLoader,
} from '../../docs/documents.js';
import type {DiscoveredWorkflow} from '../../workflows/discovery.js';
import {MarkdownDocumentPage} from '../components/markdown-document-page.js';
import {Page} from '../components/page.js';
import {useWorkflowSelection, type WorkflowDiscovery} from '../components/workflow-selector.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

type Topic = {id: string; label: string; description?: string; load: DocumentsLoader};

/**
 * The documentation index: the application's own documents first, then one topic per discovered
 * workflow. Topics come from discovery, so a new workflow appears without changes here.
 */
export function DocumentationScreen({
  appLabel,
  discoverWorkflows,
  onBack,
  inputActive,
  loadGeneral = () => readGeneralDocuments(generalDocumentNames),
  loadWorkflow = workflow => readWorkflowDocuments(workflow),
}: {
  appLabel: string;
  discoverWorkflows: WorkflowDiscovery;
  onBack: () => void;
  inputActive: boolean;
  loadGeneral?: DocumentsLoader;
  loadWorkflow?: (workflow: DiscoveredWorkflow) => ReturnType<DocumentsLoader>;
}): React.JSX.Element {
  const {discovery} = useWorkflowSelection(discoverWorkflows);
  const [selectedId, setSelectedId] = useState('general');
  const [openId, setOpenId] = useState<string>();

  const topics: Topic[] = [
    {id: 'general', label: appLabel, load: loadGeneral},
    ...(discovery.state === 'ready' ? discovery.workflows : []).map(workflow => ({
      id: `workflow:${workflow.manifest.id}`,
      label: workflow.manifest.label,
      description: workflow.manifest.description,
      load: () => loadWorkflow(workflow),
    })),
  ];
  const selectedIndex = Math.max(0, topics.findIndex(topic => topic.id === selectedId));
  const open = topics.find(topic => topic.id === openId);

  useInput(
    (_input, key) => {
      if (key.escape) {
        onBack();
      } else if (key.upArrow || key.downArrow) {
        const offset = key.upArrow ? -1 : 1;
        setSelectedId(topics[(selectedIndex + offset + topics.length) % topics.length]?.id ?? selectedId);
      } else if (key.return) {
        setOpenId(topics[selectedIndex]?.id);
      }
    },
    {isActive: inputActive && open === undefined},
  );

  if (open) {
    return (
      <MarkdownDocumentPage
        title="Documentation"
        detail={open.label}
        load={open.load}
        onClose={() => setOpenId(undefined)}
        back="Back to documentation"
        inputActive={inputActive}
      />
    );
  }

  return (
    <Page title="Documentation" shortcuts={['↑/↓ — Select', 'Enter — Open']}>
      {topics.map((topic, index) => {
        const selected = index === selectedIndex;
        return (
          <Box key={topic.id} flexDirection="column" marginBottom={1}>
            <Text bold={selected} color={selected ? 'cyan' : undefined}>
              {selected ? '› ' : '  '}{sanitizeTerminalText(topic.label)}
            </Text>
            {topic.description ? (
              <Box marginLeft={2}>
                <Text color={mutedColor} wrap="wrap">{sanitizeTerminalText(topic.description)}</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      {discovery.state === 'loading' ? <Text color={mutedColor}>Discovering workflows…</Text> : null}
      {discovery.state === 'failed' ? (
        <Alert variant="error" title="Workflow discovery failed.">{sanitizeTerminalText(discovery.message)}</Alert>
      ) : null}
    </Page>
  );
}
