import {existsSync} from 'node:fs';
import {basename, relative, resolve} from 'node:path';
import React, {useLayoutEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, measureElement, Text, useInput, useWindowSize, type DOMElement} from 'ink';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import type {LoadedWorkflowResult} from '../../workflows/results.js';
import type {ResultPath} from '../../workflows/annotation-transfer/results.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {AnnotationTransferResults, annotationTransferHelpSections} from './annotation-transfer-results.js';
import {HelpContent} from '../components/help.js';
import {runHelpSections} from './run-help.js';
import type {WorkflowExecutionOutcome} from '../new-run-screen/workflow-execution.js';
import type {ExistingRunMetadata} from '../../workflows/run-discovery.js';
import {formatLocalDateTime} from "../utils.js";
import {SectionList, type SectionListItem} from "./section-list.js";
import {mutedColor} from '../theme.js';

export type SupportPath = ResultPath & {id: string; label: string};

/** Resolves the run-level support files and checks whether each currently exists. */
export function runSupportPaths(runDirectory: string, pathExists: (path: string) => boolean): SupportPath[] {
  const directory = resolve(runDirectory);
  return [
    {id: 'run.directory', label: 'Run directory', absolutePath: directory},
    {id: 'run.artifacts', label: 'Artifact index', absolutePath: resolve(directory, 'artifacts.yaml')},
    {id: 'run.provenance', label: 'Run provenance', absolutePath: resolve(directory, 'provenance/run.json')},
    {id: 'run.logs', label: 'Complete step logs', absolutePath: resolve(directory, 'logs')},
  ].map(value => ({
    ...value,
    path: relative(directory, value.absolutePath) || '.',
    available: pathExists(value.absolutePath),
  }));
}

/** Lists the distinct absolute paths of linked results and support files that are unavailable. */
export function missingResultPaths(
  result: Extract<LoadedWorkflowResult, {kind: 'compatible'}>['result'],
  supportPaths: readonly SupportPath[],
): string[] {
  return [...new Set([
    result.metricsPath,
    ...Object.values(result.reports),
    ...Object.values(result.evidence),
    ...supportPaths,
  ].filter(value => !value.available).map(value => value.absolutePath))];
}

/** Generic run-result shell. Workflow-specific interpretation is delegated explicitly. */
export function RunResultsScreen({
  runDirectory,
  manifest,
  loaded,
  onBack,
  inputActive = true,
  pathExists = existsSync,
  executionOutcome,
  runMetadata,
  formatDateTime = formatLocalDateTime,
}: {
  runDirectory: string;
  manifest: WorkflowManifest;
  loaded: LoadedWorkflowResult;
  onBack?: () => void;
  inputActive?: boolean;
  pathExists?: (path: string) => boolean;
  executionOutcome?: WorkflowExecutionOutcome;
  runMetadata?: ExistingRunMetadata;
  formatDateTime?: (value: string) => string;
}): React.JSX.Element {
  const {columns, rows} = useWindowSize();
  const contentRef = useRef<DOMElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [view, setView] = useState<'results' | 'help'>('results');
  const [scrollOffsets, setScrollOffsets] = useState({results: 0, help: 0});
  const visibleRows = Math.max(5, rows - 12);
  const maximumScrollOffset = Math.max(0, contentHeight - visibleRows);
  const effectiveScrollOffset = Math.min(scrollOffsets[view], maximumScrollOffset);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setContentHeight(measureElement(contentRef.current).height);
    }
  }, [columns, rows, loaded, view]);

  const scrollBy = (delta: number): void => {
    setScrollOffsets(current => ({
      ...current,
      [view]: Math.max(0, Math.min(maximumScrollOffset, Math.min(current[view], maximumScrollOffset) + delta)),
    }));
  };

  useInput((input, key) => {
    if (!inputActive) {
      return;
    }
    if (view === 'help' && (key.escape || input === '?')) {
      setView('results');
    } else if (key.escape) {
      onBack?.();
    } else if (input === '?') {
      setView('help');
    } else if (key.upArrow) {
      scrollBy(-1);
    } else if (key.downArrow) {
      scrollBy(1);
    } else if (key.pageUp) {
      scrollBy(-visibleRows);
    } else if (key.pageDown) {
      scrollBy(visibleRows);
    }
  });

  const compatible = loaded.kind === 'compatible' ? loaded : undefined;
  const incompatible = loaded.kind === 'incompatible' ? loaded : undefined;
  const result = compatible?.result;
  const configuration = compatible?.configuration;
  const metadata = configuration ? {
    id: configuration.run.id,
    name: configuration.run.name,
    description: configuration.run.description,
    createdAt: configuration.run.created_at,
  } : runMetadata;

  const supportPaths = runSupportPaths(runDirectory, pathExists);
  let missingPaths: string[];
  if (result) {
    missingPaths = missingResultPaths(result, supportPaths);
  } else {
    missingPaths = supportPaths
        .filter(value => !value.available)
        .map(value => value.absolutePath);
  }

  let statusVariant: any;
  if (result?.status === 'completed') {
    statusVariant = 'success';
  } else {
    if (result?.status === 'completed-with-warnings') {
      statusVariant = 'warning';
    } else {
      statusVariant = 'error';
    }
  }

  const runFileItems: SectionListItem[] = [];
  if (executionOutcome) {
    runFileItems.push({id: 'run.stdout', label: 'Current attempt stdout', value: sanitizeTerminalText(executionOutcome.stdoutLogPath)});
    runFileItems.push({id: 'run.stderr', label: 'Current attempt stderr', value: sanitizeTerminalText(executionOutcome.stderrLogPath)});
  }
  for (const item of supportPaths) {
    runFileItems.push({
      id: item.id,
      label: item.label,
      value: `${sanitizeTerminalText(item.path)}${item.available ? '' : ' (missing)'}`,
      color: item.available ? undefined : 'yellow',
    });
  }

  const metadataItems: SectionListItem[] = [
    {id: 'run.id', label: 'Run ID', value: sanitizeTerminalText(metadata?.id ?? basename(resolve(runDirectory)))},
  ];
  if (metadata?.name) {
    metadataItems.push({id: 'run.name', label: 'Name', value: sanitizeTerminalText(metadata.name)});
  }
  if (metadata?.description) {
    metadataItems.push({id: 'run.description', label: 'Description', value: sanitizeTerminalText(metadata.description)});
  }
  metadataItems.push({
    id: 'run.workflow',
    label: 'Workflow',
    value: `${sanitizeTerminalText(manifest.label)} (${sanitizeTerminalText(manifest.id)}@${String(manifest.workflow_version)})`,
  });
  if (result || metadata?.createdAt) {
    metadataItems.push({id: 'run.created', label: 'Created', value: formatDateTime(result?.run.createdAt ?? metadata?.createdAt ?? '')});
  }
  if (result) {
    metadataItems.push({id: 'run.summary_generated', label: 'Summary generated', value: formatDateTime(result.generatedAt)});
    metadataItems.push({id: 'run.effective_cpus', label: 'Effective CPUs', value: String(result.run.effectiveCpus)});
  }

  const helpSections = runHelpSections({
    metadataItems,
    fileItems: runFileItems,
    hasStatus: result !== undefined,
    workflowSections: result ? annotationTransferHelpSections(result) : [],
  });

  return (
    <Box flexDirection="column">
      <Box
        height={contentHeight === 0 ? undefined : visibleRows}
        overflow={contentHeight === 0 ? 'visible' : 'hidden'}
        flexDirection="column"
      >
        <Box ref={contentRef} marginTop={-effectiveScrollOffset} flexDirection="column" flexShrink={0}>
          {view === 'help' ? (
            <HelpContent
              title="Result help"
              intro="Each entry explains one item of the result page. Recorded definitions were saved with this run by the workflow."
              sections={helpSections}
            />
          ) : <>
          <SectionList title={'Run Metadata'} items={metadataItems}>
            {runMetadata && (runMetadata.workflowId !== manifest.id || runMetadata.workflowVersion !== manifest.workflow_version) ? (
                <Alert variant="warning">
                  Saved workflow identity is different from the current one: {sanitizeTerminalText(runMetadata.workflowId)}:v{String(runMetadata.workflowVersion)}
                </Alert>
            ) : null}
          </SectionList>

          <SectionList title="Run Directory" items={[]}>
            <Box marginTop={1}>
              <Text wrap="truncate-start">{runDirectory}</Text>
            </Box>
          </SectionList>

          {executionOutcome ? (
            <Box marginTop={1} flexDirection="column">
              <Alert variant={executionOutcome.succeeded ? 'success' : 'error'}>
                {executionOutcome.succeeded
                  ? result
                    ? 'Workflow execution completed; persisted results were reloaded from disk.'
                    : 'Workflow execution completed, but persisted results cannot be interpreted.'
                  : 'Workflow execution failed; any persisted evidence produced before failure is shown below.'}
              </Alert>
              {executionOutcome.exitCode !== undefined && executionOutcome.exitCode !== null && executionOutcome.exitCode !== 0 ? (
                <Alert variant="error">Snakemake exited with code {String(executionOutcome.exitCode)}.</Alert>
              ) : null}
              {executionOutcome.error ? <Alert variant="error">{sanitizeTerminalText(executionOutcome.error)}</Alert> : null}
            </Box>
          ) : null}

          {result ? (
            <Box marginTop={1} flexDirection="column">
              <Alert variant={statusVariant}>{sanitizeTerminalText(result.statusExplanation)}</Alert>
              {missingPaths.length > 0 ? (
                <Alert variant="warning">
                  {String(missingPaths.length)} linked result {missingPaths.length === 1 ? 'path is' : 'paths are'} missing. Available results remain visible below.
                </Alert>
              ) : null}
            </Box>
          ) : (
            <Box marginTop={1} flexDirection="column">
              <Alert variant="warning">Persisted results cannot be interpreted by this application.</Alert>
              <Text wrap="wrap">{sanitizeTerminalText(incompatible?.error.message ?? 'Unknown compatibility error.')}</Text>
              {incompatible?.error.path ? <Text>{sanitizeTerminalText(incompatible.error.path)}</Text> : null}
              {missingPaths.length > 0 ? (
                <Alert variant="warning">
                  {String(missingPaths.length)} run {missingPaths.length === 1 ? 'path is' : 'paths are'} currently missing.
                </Alert>
              ) : null}
            </Box>
          )}

          {result ? <AnnotationTransferResults result={result} /> : null}

          <SectionList title="Run Files" description="" items={runFileItems} />
          </>}
        </Box>
      </Box>
      <Text color={mutedColor}>
        {maximumScrollOffset > 0 ? '↑/↓ — Scroll · PageUp/PageDown (or fn + ↑/↓) — Page · ' : ''}
        {view === 'help' ? 'Esc or ? — Back to results' : `? — Help${onBack ? ' · Esc — Back' : ''}`}
      </Text>
    </Box>
  );
}
