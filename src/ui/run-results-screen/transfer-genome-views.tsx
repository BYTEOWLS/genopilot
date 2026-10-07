import React, {useEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text} from 'ink';
import {browserViewShortcut} from '../../browser/contract.js';
import {documentView} from '../../browser/documents.js';
import {useGenomeSession} from '../../browser/use-genome-session.js';
import type {Document, DocumentsLoader} from '../../docs/documents.js';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import type {CompatibleAnnotationTransferResult} from '../../workflows/results.js';
import type {ReviewGene} from '../../workflows/annotation-transfer/proteins.js';
import {reviewItemId, transferReferenceView, transferReviewView, transferTargetView} from '../../workflows/annotation-transfer/views.js';
import {sanitizeTerminalText} from '../sanitize.js';

const choices = [
  {id: 'target', label: 'Target', description: 'transferred annotation and LiftOn\'s candidate models'},
  {id: 'reference', label: 'Reference', description: 'source annotation'},
  {id: 'proteins', label: 'Proteins', description: 'the genes listed for review, on the target'},
] as const;
const proteinsChoice = choices.findIndex(choice => choice.id === 'proteins');

/** The Proteins tab's list, which the Proteins view shows as its items and follows. */
export type ReviewList = {
  /** False when the run has no protein rating or its genes are not read yet. */
  available: boolean;
  listed: readonly ReviewGene[];
  selected?: ReviewGene;
  select: (referenceId: string) => void;
};

type Key = {upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean};

/** Terminal rows the open choice takes: a rule, the heading, one row per choice, and a rule. */
const choiceRows = choices.length + 3;

/**
 * `v` on an annotation-transfer result: a choice between the target and the reference genome
 * view. The result screen routes keys here first, shows `status` above its results and `choice`
 * below them, and gives the results `choiceRows` fewer rows while the choice is open.
 */
export function useTransferGenomeViews({loaded, runDirectory, manifest, loadHelp, scope, review, onProteinsTab, citation}: {
  loaded?: CompatibleAnnotationTransferResult;
  runDirectory: string;
  manifest: WorkflowManifest;
  loadHelp: DocumentsLoader;
  /** The opening context; changing it closes the view. */
  scope: string;
  review: ReviewList;
  /** Whether the Proteins tab is shown, where `v` opens the selected gene without the choice. */
  onProteinsTab: boolean;
  /** The run's citation, which the opened views offer. */
  citation?: Document;
}) {
  const genome = useGenomeSession(scope, citation);
  const browser = genome.browser;
  const [choice, setChoice] = useState<number>();
  const [notice, setNotice] = useState<string>();
  const opened = useRef<typeof choices[number]['id']>(undefined);
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const canView = !!loaded && !!browser?.genomeAvailable && !genome.busy;
  const selectFromBrowser = (id: string): void => reviewRef.current.select(id);

  // The Proteins view follows the tab's selection; the browser's previous and next move it back.
  useEffect(() => {
    const selected = review.selected;
    if (opened.current === 'proteins' && selected?.target) {
      genome.updateSelection(reviewItemId(selected), selectFromBrowser);
    }
  }, [review.selected]);
  useEffect(() => {
    opened.current = undefined;
  }, [scope]);
  useEffect(() => {
    setNotice(undefined);
  }, [review.selected, onProteinsTab]);

  const open = (index: number): void => {
    const selected = choices[index];
    if (!loaded || !browser || !selected || (selected.id === 'proteins' && !review.available)) {
      return;
    }
    opened.current = selected.id;
    const {listed, selected: gene} = review;
    genome.open(async signal => {
      const documents = await loadHelp();
      signal.throwIfAborted();
      const guide = documentView(manifest.id, documents, documents[0]?.id ?? '', browser.application).content.documents[0];
      const context = {runDirectory, configuration: loaded.configuration, application: browser.application,
        workflow: {id: manifest.id, version: manifest.workflow_version, label: manifest.label}, guide, signal};
      if (selected.id === 'proteins') {
        const view = await transferReviewView({...context, genes: listed, selected: gene});
        // The selection may have moved while the checksums were verified.
        const current = reviewRef.current.selected;
        return current?.target ? {...view, selectedItemId: reviewItemId(current)} : view;
      }
      return selected.id === 'target' ? transferTargetView(context) : transferReferenceView(context);
    }, selected.id === 'proteins' ? selectFromBrowser : undefined);
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
      setNotice(undefined);
      // On the Proteins tab `v` opens the selected gene's locus directly; the choice is for the other tabs.
      if (onProteinsTab) {
        if (!review.selected?.target) {
          setNotice(review.selected ? `${review.selected.referenceId} has no target locus to show: it was not transferred.` : 'No gene is selected.');
        } else {
          open(proteinsChoice);
        }
      } else {
        setChoice(0);
      }
      return true;
    }
    return false;
  };

  const status = (
    <>
      {genome.busy ? <Text>Checking genome checksums…</Text> : null}
      {genome.error ? <Alert variant="error">{sanitizeTerminalText(genome.error)}</Alert> : null}
      {notice ? <Alert variant="warning">{sanitizeTerminalText(notice)}</Alert> : null}
    </>
  );
  // Set apart from the results above it by a rule on each side.
  const choiceElement = choice !== undefined ? (
    <Box flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false}>
      <Text bold>View in browser</Text>
      {choices.map((option, index) => (
        <Text key={option.id} inverse={index === choice} dimColor={option.id === 'proteins' && !review.available}>
          {index === choice ? '› ' : '  '}{option.label} — {option.description}
          {option.id === 'proteins' && !review.available ? ' (unavailable: no genes listed for review)' : ''}
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
