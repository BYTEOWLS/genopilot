import {existsSync} from 'node:fs';
import {basename, relative, resolve} from 'node:path';
import React, {useLayoutEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, measureElement, Text, useInput, useWindowSize, type DOMElement} from 'ink';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import {
  isAnnotationTransferResult,
  isReferenceConsensusResult,
  type LoadedWorkflowResult,
  type ResultShell,
} from '../../workflows/results.js';
import type {ResultPath} from '../../workflows/annotation-transfer/results.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {AnnotationTransferResults, annotationTransferHelpSections} from './annotation-transfer-results.js';
import {
  consensusTabs,
  initialConsensusView,
  ReferenceConsensusResults,
  referenceConsensusHelpSections,
  selectableTableHeaderLines,
  type ConsensusView,
} from './reference-consensus-results.js';
import {Page} from '../components/page.js';
import {HelpContent} from '../components/help.js';
import {TabBar} from '../components/tabs.js';
import {runHelpSections} from './run-help.js';
import type {WorkflowExecutionOutcome} from '../new-run-screen/workflow-execution.js';
import type {ExistingRunMetadata} from '../../workflows/run-discovery.js';
import {formatLocalDateTime} from "../utils.js";
import {SectionList, type SectionListItem} from "./section-list.js";

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
  shell: ResultShell,
  supportPaths: readonly SupportPath[],
): string[] {
  return [...new Set([
    ...shell.linkedPaths,
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
  const consensus = isReferenceConsensusResult(loaded) ? loaded.result : undefined;
  const [consensusView, setConsensusView] = useState<ConsensusView | undefined>(
    () => consensus ? initialConsensusView(consensus) : undefined,
  );
  // The tab bar takes two more rows above the scrolled content.
  const visibleRows = Math.max(5, rows - (consensus ? 17 : 15));
  const maximumScrollOffset = Math.max(0, contentHeight - visibleRows);
  const effectiveScrollOffset = Math.min(scrollOffsets[view], maximumScrollOffset);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setContentHeight(measureElement(contentRef.current).height);
    }
  }, [columns, rows, loaded, view, consensusView]);

  const scrollBy = (delta: number): void => {
    setScrollOffsets(current => ({
      ...current,
      [view]: Math.max(0, Math.min(maximumScrollOffset, Math.min(current[view], maximumScrollOffset) + delta)),
    }));
  };

  /** Scrolls the least needed to show the row `index` of the table at the top of the content. */
  const revealRow = (index: number): void => {
    const line = selectableTableHeaderLines + index;
    setScrollOffsets(current => {
      let offset = Math.min(current.results, maximumScrollOffset);
      if (line < offset + selectableTableHeaderLines) {
        offset = Math.max(0, line - selectableTableHeaderLines);
      } else if (line >= offset + visibleRows) {
        offset = line - visibleRows + 1;
      }
      return {...current, results: offset};
    });
  };

  /** Handles a key of the consensus tabs; false when the key is the shell's to handle. */
  const consensusKey = (key: {upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean}): boolean => {
    if (!consensus || !consensusView) {
      return false;
    }
    const {tab, isolateDetail} = consensusView;
    const listed = tab === 'isolates' && !isolateDetail ? consensus.isolates.length
      : tab === 'cohorts' ? consensus.cohorts.length
        : 0;
    if (listed > 0 && (key.upArrow || key.downArrow)) {
      const field = tab === 'isolates' ? 'isolateIndex' : 'cohortIndex';
      const index = Math.max(0, Math.min(listed - 1, consensusView[field] + (key.upArrow ? -1 : 1)));
      setConsensusView({...consensusView, [field]: index});
      revealRow(index);
      return true;
    }
    if (tab === 'isolates' && !isolateDetail && key.return && listed > 0) {
      setConsensusView({...consensusView, isolateDetail: true});
      setScrollOffsets(current => ({...current, results: 0}));
      return true;
    }
    if (tab === 'isolates' && isolateDetail && key.escape) {
      setConsensusView({...consensusView, isolateDetail: false});
      revealRow(consensusView.isolateIndex);
      return true;
    }
    return false;
  };

  useInput((input, key) => {
    if (!inputActive) {
      return;
    }
    if (view === 'help' && (key.escape || input === '?')) {
      setView('results');
    } else if (view === 'results' && consensusKey(key)) {
      return;
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
  const shell = compatible?.shell;
  const annotationTransfer = isAnnotationTransferResult(loaded) ? loaded.result : undefined;
  const configuration = compatible?.configuration;
  const metadata = configuration ? {
    id: configuration.run.id,
    name: configuration.run.name,
    description: configuration.run.description,
    createdAt: configuration.run.created_at,
  } : runMetadata;

  const supportPaths = runSupportPaths(runDirectory, pathExists);
  let missingPaths: string[];
  if (shell) {
    missingPaths = missingResultPaths(shell, supportPaths);
  } else {
    missingPaths = supportPaths
        .filter(value => !value.available)
        .map(value => value.absolutePath);
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
  if (metadata?.createdAt) {
    metadataItems.push({id: 'run.created', label: 'Created', value: formatDateTime(metadata.createdAt)});
  }
  if (shell?.generatedAt) {
    metadataItems.push({id: 'run.summary_generated', label: 'Results written', value: formatDateTime(shell.generatedAt)});
  }
  if (shell) {
    metadataItems.push({id: 'run.effective_cpus', label: 'Effective CPUs', value: String(shell.effectiveCpus)});
  }

  let workflowSections: ReturnType<typeof annotationTransferHelpSections> = [];
  if (annotationTransfer) {
    workflowSections = annotationTransferHelpSections(annotationTransfer);
  } else if (consensus) {
    workflowSections = referenceConsensusHelpSections(consensus);
  }
  const helpSections = runHelpSections({
    metadataItems,
    fileItems: runFileItems,
    status: annotationTransfer ? 'annotation-transfer' : consensus ? 'reference-consensus' : undefined,
    workflowSections,
  });

  const metadataSection = (
    <SectionList title={'Run Metadata'} items={metadataItems}>
      {runMetadata && (runMetadata.workflowId !== manifest.id || runMetadata.workflowVersion !== manifest.workflow_version) ? (
          <Alert variant="warning">
            Saved workflow identity is different from the current one: {sanitizeTerminalText(runMetadata.workflowId)}:v{String(runMetadata.workflowVersion)}
          </Alert>
      ) : null}
    </SectionList>
  );
  const runDirectorySection = (
    <SectionList title="Run Directory" items={[]}>
      <Box marginTop={1}>
        <Text wrap="truncate-start">{runDirectory}</Text>
      </Box>
    </SectionList>
  );
  const outcomeSection = executionOutcome ? (
    <Box marginTop={1} flexDirection="column">
      <Alert variant={executionOutcome.succeeded ? 'success' : 'error'}>
        {executionOutcome.succeeded
          ? shell
            ? 'Workflow execution completed; persisted results were reloaded from disk.'
            : 'Workflow execution completed, but persisted results cannot be interpreted.'
          : 'Workflow execution failed; any persisted evidence produced before failure is shown below.'}
      </Alert>
      {executionOutcome.exitCode !== undefined && executionOutcome.exitCode !== null && executionOutcome.exitCode !== 0 ? (
        <Alert variant="error">Snakemake exited with code {String(executionOutcome.exitCode)}.</Alert>
      ) : null}
      {executionOutcome.error ? <Alert variant="error">{sanitizeTerminalText(executionOutcome.error)}</Alert> : null}
    </Box>
  ) : null;
  const statusSection = shell ? (
    <Box marginTop={1} flexDirection="column">
      <Alert variant={shell.status.variant}>{sanitizeTerminalText(shell.status.explanation)}</Alert>
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
  );
  const runFilesSection = <SectionList title="Run Files" description="" items={runFileItems} />;

  const listTab = consensusView && (consensusView.tab === 'cohorts' ||
    (consensusView.tab === 'isolates' && !consensusView.isolateDetail));
  let shortcuts: string[];
  if (view === 'help') {
    shortcuts = ['? — Back to results'];
  } else {
    shortcuts = [
      consensus ? 'Tab/←/→ — Switch tab' : '',
      listTab ? '↑/↓ — Select' : maximumScrollOffset > 0 ? '↑/↓ — Scroll' : '',
      maximumScrollOffset > 0 ? 'PageUp/PageDown (or fn + ↑/↓) — Page' : '',
      consensusView?.tab === 'isolates' && !consensusView.isolateDetail ? 'Enter — Isolate details' : '',
      '? — Help',
    ];
  }
  let back: string | false = onBack ? 'Back' : false;
  if (view === 'help') {
    back = 'Back to results';
  } else if (consensusView?.isolateDetail) {
    back = 'Back to isolates';
  }

  return (
    <Page
      title={view === 'help' ? 'Result help' : 'Run results'}
      detail={view === 'help' ? undefined : metadata?.name ?? manifest.label}
      header={consensusView && view === 'results' ? (
        <TabBar
          tabs={consensusTabs}
          activeId={consensusView.tab}
          onChange={tab => {
            setConsensusView({...consensusView, tab, isolateDetail: false});
            setScrollOffsets(current => ({...current, results: 0}));
          }}
          inputActive={inputActive}
        />
      ) : undefined}
      description={view === 'help'
        ? 'Each entry explains one item of the result page. Recorded definitions were saved with this run by the workflow.'
        : undefined}
      shortcuts={shortcuts}
      back={back}
    >
      <Box
        height={contentHeight === 0 ? undefined : visibleRows}
        overflow={contentHeight === 0 ? 'visible' : 'hidden'}
        flexDirection="column"
      >
        <Box ref={contentRef} marginTop={-effectiveScrollOffset} flexDirection="column" flexShrink={0}>
          {view === 'help' ? (
            <HelpContent sections={helpSections} />
          ) : consensus && consensusView ? (
            <ReferenceConsensusResults
              result={consensus}
              view={consensusView}
              formatDateTime={formatDateTime}
              overviewHeader={<>{metadataSection}{outcomeSection}{statusSection}</>}
              filesHeader={<>{runDirectorySection}{runFilesSection}</>}
            />
          ) : <>
          {metadataSection}
          {runDirectorySection}
          {outcomeSection}
          {statusSection}
          {annotationTransfer ? <AnnotationTransferResults result={annotationTransfer} /> : null}
          {runFilesSection}
          </>}
        </Box>
      </Box>
    </Page>
  );
}
