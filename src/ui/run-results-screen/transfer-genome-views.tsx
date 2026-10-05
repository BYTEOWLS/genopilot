import React, {useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text} from 'ink';
import {browserViewShortcut} from '../../browser/contract.js';
import {documentView} from '../../browser/documents.js';
import {useGenomeSession} from '../../browser/use-genome-session.js';
import type {DocumentsLoader} from '../../docs/documents.js';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import type {CompatibleAnnotationTransferResult} from '../../workflows/results.js';
import {transferReferenceView, transferTargetView} from '../../workflows/annotation-transfer/views.js';
import {sanitizeTerminalText} from '../sanitize.js';

const choices = [
  {id: 'target', label: 'Target', description: 'transferred annotation and LiftOn\'s candidate models', build: transferTargetView},
  {id: 'reference', label: 'Reference', description: 'source annotation', build: transferReferenceView},
] as const;

type Key = {upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean};

/** Terminal rows the open choice takes: a rule, the heading, one row per choice, and a rule. */
const choiceRows = choices.length + 3;

/**
 * `v` on an annotation-transfer result: a choice between the target and the reference genome
 * view. The result screen routes keys here first, shows `status` above its results and `choice`
 * below them, and gives the results `choiceRows` fewer rows while the choice is open.
 */
export function useTransferGenomeViews({loaded, runDirectory, manifest, loadHelp, scope}: {
  loaded?: CompatibleAnnotationTransferResult;
  runDirectory: string;
  manifest: WorkflowManifest;
  loadHelp: DocumentsLoader;
  /** The opening context; changing it closes the view. */
  scope: string;
}) {
  const genome = useGenomeSession(scope);
  const browser = genome.browser;
  const [choice, setChoice] = useState<number>();
  const canView = !!loaded && !!browser?.genomeAvailable && !genome.busy;

  const open = (index: number): void => {
    const selected = choices[index];
    if (!loaded || !browser || !selected) {
      return;
    }
    genome.open(async signal => {
      const documents = await loadHelp();
      signal.throwIfAborted();
      const guide = documentView(manifest.id, documents, documents[0]?.id ?? '', browser.application).content.documents[0];
      return selected.build({runDirectory, configuration: loaded.configuration, application: browser.application,
        workflow: {id: manifest.id, version: manifest.workflow_version, label: manifest.label}, guide, signal});
    });
  };

  /** Handles a key; false when it is the screen's to handle. */
  const handleInput = (input: string, key: Key): boolean => {
    if (choice !== undefined) {
      if (key.escape) {
        setChoice(undefined);
      } else if (key.upArrow || key.downArrow) {
        setChoice(Math.max(0, Math.min(choices.length - 1, choice + (key.upArrow ? -1 : 1))));
      } else if (key.return) {
        setChoice(undefined);
        open(choice);
      }
      return true;
    }
    if (input === 'v' && canView) {
      genome.clearError();
      setChoice(0);
      return true;
    }
    return false;
  };

  const status = (
    <>
      {genome.busy ? <Text>Checking genome checksums…</Text> : null}
      {genome.error ? <Alert variant="error">{sanitizeTerminalText(genome.error)}</Alert> : null}
    </>
  );
  // Set apart from the results above it by a rule on each side.
  const choiceElement = choice !== undefined ? (
    <Box flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false}>
      <Text bold>View in browser</Text>
      {choices.map((option, index) => (
        <Text key={option.id} inverse={index === choice}>
          {index === choice ? '› ' : '  '}{option.label} — {option.description}
        </Text>
      ))}
    </Box>
  ) : null;
  const shortcuts = choice !== undefined
    ? ['↑/↓ — Select', 'Enter — Open view']
    : [
      canView ? browserViewShortcut : '',
      loaded && browser && !browser.genomeAvailable ? `${browserViewShortcut} (unavailable: release bundling pending)` : '',
    ];
  return {choosing: choice !== undefined, handleInput, status, choice: choiceElement, choiceRows: choice !== undefined ? choiceRows : 0, shortcuts,
    back: choice !== undefined ? 'Cancel' : undefined};
}
