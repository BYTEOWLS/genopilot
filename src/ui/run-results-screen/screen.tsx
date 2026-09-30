import {existsSync} from 'node:fs';
import {basename, join, relative, resolve} from 'node:path';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, measureElement, Text, useInput, useWindowSize, type DOMElement} from 'ink';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import {
  isAnnotationTransferResult,
  isReferenceConsensusResult,
  loadWorkflowResult,
  type LoadedWorkflowResult,
  type ResultShell,
} from '../../workflows/results.js';
import {executeSnakemakeRun, type SnakemakeRun} from '../../workflows/execution.js';
import {
  saveNextCohortDecision,
  type CohortDecisionDraft,
} from '../../workflows/reference-consensus/cohort-decision.js';
import {
  checkIterationDryRun,
  iterationName,
  iterationRules,
  prepareIterationRun,
} from '../../workflows/reference-consensus/iteration-run.js';
import {readCohortSites, siteFilters} from '../../workflows/reference-consensus/sites.js';
import type {ResultPath} from '../../workflows/annotation-transfer/results.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {
  AnnotationTransferResults,
  annotationTransferTabs,
  type AnnotationTransferTabId,
} from './annotation-transfer-results.js';
import {
  cohortSiteTables,
  consensusTabs,
  filteredSites,
  initialConsensusView,
  ReferenceConsensusResults,
  selectableTableHeaderLines,
  type ConsensusView,
  type SitesState,
} from './reference-consensus-results.js';
import {CohortReviewScreen} from './cohort-review.js';
import {Page} from '../components/page.js';
import {DocumentPage} from '../components/document-page.js';
import {TabBar} from '../components/tabs.js';
import {readGeneralDocuments, readWorkflowDocumentsById, type DocumentsLoader} from '../../docs/documents.js';
import {
  WorkflowExecutionScreen,
  type WorkflowExecutionOutcome,
  type WorkflowRunExecutor,
} from '../new-run-screen/workflow-execution.js';
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

/**
 * What a results screen needs to review a reference-consensus cohort and rerun its iterations.
 * Without it, the review and continue actions are not offered.
 */
export type CohortRerun = {
  /** The packaged Snakefile of the run's workflow. */
  snakefilePath: string;
  prepareRun?: typeof prepareIterationRun;
  executeRun?: WorkflowRunExecutor<SnakemakeRun>;
  checkDryRun?: typeof checkIterationDryRun;
  saveDecision?: (runDirectory: string, draft: CohortDecisionDraft) => Promise<number>;
  loadResult?: typeof loadWorkflowResult;
};

/** The workflow's results page, then the run metadata and files every workflow shares. */
async function loadResultHelp(workflowId: string): ReturnType<DocumentsLoader> {
  const [workflowResults, general] = await Promise.all([
    readWorkflowDocumentsById(workflowId, ['results.md']),
    readGeneralDocuments(['run-results']),
  ]);
  return [...workflowResults, ...general];
}

type ScreenMode = {kind: 'results'} | {kind: 'review'} | {kind: 'rerun'; iteration: number};

/** Generic run-result shell. Workflow-specific interpretation is delegated explicitly. */
export function RunResultsScreen({
  runDirectory,
  manifest,
  loaded: initiallyLoaded,
  onBack,
  inputActive = true,
  pathExists = existsSync,
  executionOutcome,
  runMetadata,
  formatDateTime = formatLocalDateTime,
  cohortRerun,
  readSites = readCohortSites,
  loadHelp = () => loadResultHelp(manifest.id),
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
  cohortRerun?: CohortRerun;
  readSites?: typeof readCohortSites;
  /** The documents result help shows; the workflow's results page and the general run results. */
  loadHelp?: DocumentsLoader;
}): React.JSX.Element {
  const {columns, rows} = useWindowSize();
  const contentRef = useRef<DOMElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [view, setView] = useState<'results' | 'help'>('results');
  const [scrollOffsets, setScrollOffsets] = useState({results: 0});
  // Reloaded from disk after a cohort iteration ran from this screen.
  const [loaded, setLoaded] = useState(initiallyLoaded);
  const [mode, setMode] = useState<ScreenMode>({kind: 'results'});
  const consensus = isReferenceConsensusResult(loaded) ? loaded.result : undefined;
  const annotationTransfer = isAnnotationTransferResult(loaded) ? loaded.result : undefined;
  const [consensusView, setConsensusView] = useState<ConsensusView | undefined>(
    () => consensus ? initialConsensusView(consensus) : undefined,
  );
  const [annotationTab, setAnnotationTab] = useState<AnnotationTransferTabId>('overview');
  const [sites, setSites] = useState<SitesState>();
  const sitesCohort = consensus && consensusView?.tab === 'sites' ? consensus.cohorts[consensusView.cohortIndex] : undefined;
  const sitesTables = cohortSiteTables(sitesCohort);
  const sitesCohortId = sitesTables ? sitesCohort?.id : undefined;
  const loadedSitesCohortId = sites && sites.state !== 'failed' ? sites.cohortId : undefined;

  // The Sites tab reads the selected cohort's tables once, when it is first shown; leaving the tab
  // or choosing another cohort before they are read cancels the reading.
  useEffect(() => {
    if (!sitesCohortId || !sitesTables || loadedSitesCohortId === sitesCohortId) {
      return;
    }
    const controller = new AbortController();
    setSites({cohortId: sitesCohortId, state: 'loading'});
    readSites({...sitesTables, signal: controller.signal}).then(
      value => setSites({cohortId: sitesCohortId, state: 'ready', sites: value}),
      error => {
        if (!controller.signal.aborted) {
          setSites({cohortId: sitesCohortId, state: 'failed', message: error instanceof Error ? error.message : String(error)});
        }
      },
    );
    return () => {
      controller.abort();
      setSites(current => current?.state === 'loading' ? undefined : current);
    };
    // The tables are derived from the cohort, so its ID is enough to decide when to read again.
  }, [sitesCohortId]);
  // The tab bar takes two more rows above the scrolled content.
  const visibleRows = Math.max(5, rows - (consensus || annotationTransfer ? 17 : 15));
  const maximumScrollOffset = Math.max(0, contentHeight - visibleRows);
  const effectiveScrollOffset = Math.min(scrollOffsets.results, maximumScrollOffset);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setContentHeight(measureElement(contentRef.current).height);
    }
  }, [columns, rows, loaded, view, consensusView, annotationTab, sites]);

  const scrollBy = (delta: number): void => {
    setScrollOffsets(current => ({
      ...current,
      results: Math.max(0, Math.min(maximumScrollOffset, Math.min(current.results, maximumScrollOffset) + delta)),
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

  /** Handles a key of the Sites tab; false when the key is the shell's to handle. */
  const sitesKey = (
    input: string,
    key: {upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean},
    current: ConsensusView,
  ): boolean => {
    if (current.siteDetail) {
      if (key.escape) {
        setConsensusView({...current, siteDetail: false});
        return true;
      }
      return key.upArrow || key.downArrow || key.return;
    }
    if (input === 'f') {
      const next = siteFilters[(siteFilters.indexOf(current.siteFilter) + 1) % siteFilters.length]!;
      setConsensusView({...current, siteFilter: next, siteIndex: 0});
      return true;
    }
    const listed = sites?.state === 'ready' && sites.cohortId === sitesCohortId
      ? filteredSites(sites.sites, current.siteFilter).length
      : 0;
    if (listed > 0 && (key.upArrow || key.downArrow)) {
      setConsensusView({...current, siteIndex: Math.max(0, Math.min(listed - 1, current.siteIndex + (key.upArrow ? -1 : 1)))});
      return true;
    }
    if (listed > 0 && key.return) {
      setConsensusView({...current, siteDetail: true, siteIndex: Math.min(current.siteIndex, listed - 1)});
      setScrollOffsets(offsets => ({...offsets, results: 0}));
      return true;
    }
    return false;
  };

  /** Handles a key of the consensus tabs; false when the key is the shell's to handle. */
  const consensusKey = (
    input: string,
    key: {upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean},
  ): boolean => {
    if (!consensus || !consensusView) {
      return false;
    }
    const {tab, isolateDetail} = consensusView;
    if (cohortRerun && input === 'r') {
      setMode({kind: 'review'});
      return true;
    }
    if (tab === 'sites') {
      return sitesKey(input, key, consensusView);
    }
    const selectedCohort = consensus.cohorts[consensusView.cohortIndex];
    if (cohortRerun && tab === 'cohorts' && input === 'c' && selectedCohort?.state === 'pending') {
      setMode({kind: 'rerun', iteration: selectedCohort.iteration});
      return true;
    }
    const listed = tab === 'isolates' && !isolateDetail ? consensus.isolates.length
      : tab === 'cohorts' ? consensus.cohorts.length
        : 0;
    if (listed > 0 && (key.upArrow || key.downArrow)) {
      const field = tab === 'isolates' ? 'isolateIndex' : 'cohortIndex';
      const index = Math.max(0, Math.min(listed - 1, consensusView[field] + (key.upArrow ? -1 : 1)));
      // The Sites tab follows the selected cohort, so its list starts over with another one.
      setConsensusView({...consensusView, [field]: index, ...(field === 'cohortIndex' ? {siteIndex: 0, siteDetail: false} : {})});
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

  /** Reloads the result after an iteration ran and selects that iteration. */
  const returnFromRerun = async (iteration: number): Promise<void> => {
    let reloaded = loaded;
    try {
      reloaded = await (cohortRerun?.loadResult ?? loadWorkflowResult)(runDirectory, manifest);
    } catch {
      // The earlier result stays shown; opening the run again reads it anew.
    }
    setLoaded(reloaded);
    const result = isReferenceConsensusResult(reloaded) ? reloaded.result : undefined;
    if (result) {
      const index = result.cohorts.findIndex(cohort => cohort.id === iterationName(iteration));
      setConsensusView(current => ({
        ...(current ?? initialConsensusView(result)),
        tab: 'cohorts',
        cohortIndex: index >= 0 ? index : result.cohorts.length - 1,
        isolateDetail: false,
        siteIndex: 0,
        siteDetail: false,
      }));
    }
    setScrollOffsets({results: 0});
    setMode({kind: 'results'});
  };

  useInput((input, key) => {
    if (!inputActive || mode.kind !== 'results' || view === 'help') {
      return;
    }
    if (consensusKey(input, key)) {
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
  // The run directory has a section of its own above the files.
  for (const item of supportPaths.filter(path => path.id !== 'run.directory')) {
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

  if (mode.kind === 'review' && consensus && cohortRerun && isReferenceConsensusResult(loaded)) {
    const save = cohortRerun.saveDecision ?? saveNextCohortDecision;
    return (
      <CohortReviewScreen
        result={consensus}
        configuration={loaded.configuration}
        saveDecision={draft => save(runDirectory, draft)}
        onSaved={iteration => setMode({kind: 'rerun', iteration})}
        onCancel={() => setMode({kind: 'results'})}
        inputActive={inputActive}
      />
    );
  }
  if (mode.kind === 'rerun' && cohortRerun && isReferenceConsensusResult(loaded)) {
    const {iteration} = mode;
    const prepare = cohortRerun.prepareRun ?? prepareIterationRun;
    const execute = cohortRerun.executeRun ?? ((run, onOutput, signal) => executeSnakemakeRun(run, onOutput, signal));
    const check = cohortRerun.checkDryRun ?? checkIterationDryRun;
    const allowed = new Set<string>(iterationRules);
    return (
      <WorkflowExecutionScreen
        configurationPath={join(resolve(runDirectory), 'decisions', `${iterationName(iteration)}.yaml`)}
        prepareRun={runMode => prepare({
          runDirectory: resolve(runDirectory),
          iteration,
          mode: runMode,
          snakefilePath: cohortRerun.snakefilePath,
          cores: loaded.configuration.resources.effective_cpus,
        })}
        executeRun={execute}
        dryRunGate={run => check(run, iteration)}
        stages={manifest.stages.filter(stage => stage.rules?.some(rule => allowed.has(rule)))}
        onBack={() => void returnFromRerun(iteration)}
        inputActive={inputActive}
        labels={{
          title: `Rerun iteration ${String(iteration)}`,
          intro: 'Decision saved. Dry-run the iteration first: it may run only when nothing but the cohort steps would run.',
          back: 'Back to results',
        }}
      />
    );
  }

  if (view === 'help') {
    return (
      <DocumentPage
        title="Result help"
        detail={manifest.label}
        load={loadHelp}
        onClose={() => setView('results')}
        back="Back to results"
        inputActive={inputActive}
      />
    );
  }

  const listTab = consensusView && (consensusView.tab === 'cohorts' ||
    (consensusView.tab === 'isolates' && !consensusView.isolateDetail) ||
    (consensusView.tab === 'sites' && !consensusView.siteDetail));
  const shortcuts = [
    consensus || annotationTransfer ? 'Tab/←/→ — Switch tab' : '',
    listTab ? '↑/↓ — Select' : maximumScrollOffset > 0 ? '↑/↓ — Scroll' : '',
    maximumScrollOffset > 0 ? 'PageUp/PageDown (or fn + ↑/↓) — Page' : '',
    consensusView?.tab === 'isolates' && !consensusView.isolateDetail ? 'Enter — Isolate details' : '',
    consensusView?.tab === 'sites' && !consensusView.siteDetail ? 'f — Filter' : '',
    consensusView?.tab === 'sites' && !consensusView.siteDetail ? 'Enter — Locus details' : '',
    cohortRerun && consensus ? 'r — Review' : '',
    cohortRerun && consensusView?.tab === 'cohorts' && consensus?.cohorts[consensusView.cohortIndex]?.state === 'pending'
      ? 'c — Continue iteration'
      : '',
    '? — Help',
  ];
  let back: string | false = onBack ? 'Back' : false;
  if (consensusView?.isolateDetail) {
    back = 'Back to isolates';
  } else if (consensusView?.tab === 'sites' && consensusView.siteDetail) {
    back = 'Back to sites';
  }

  return (
    <Page
      title="Run results"
      detail={metadata?.name ?? manifest.label}
      header={consensusView ? (
        <TabBar
          tabs={consensusTabs}
          activeId={consensusView.tab}
          onChange={tab => {
            setConsensusView({...consensusView, tab, isolateDetail: false, siteDetail: false});
            setScrollOffsets(current => ({...current, results: 0}));
          }}
          inputActive={inputActive}
        />
      ) : annotationTransfer ? (
        <TabBar
          tabs={annotationTransferTabs}
          activeId={annotationTab}
          onChange={tab => {
            setAnnotationTab(tab);
            setScrollOffsets(current => ({...current, results: 0}));
          }}
          inputActive={inputActive}
        />
      ) : undefined}
      shortcuts={shortcuts}
      back={back}
    >
      <Box
        height={contentHeight === 0 ? undefined : visibleRows}
        overflow={contentHeight === 0 ? 'visible' : 'hidden'}
        flexDirection="column"
      >
        <Box ref={contentRef} marginTop={-effectiveScrollOffset} flexDirection="column" flexShrink={0}>
          {consensus && consensusView ? (
            <ReferenceConsensusResults
              result={consensus}
              view={consensusView}
              formatDateTime={formatDateTime}
              overviewHeader={<>{outcomeSection}{statusSection}</>}
              filesHeader={<>{runDirectorySection}{runFilesSection}</>}
              runDetails={metadataSection}
              sites={sites}
              visibleRows={visibleRows}
            />
          ) : annotationTransfer ? (
            <AnnotationTransferResults
              result={annotationTransfer}
              tab={annotationTab}
              overviewHeader={<>{outcomeSection}{statusSection}</>}
              filesHeader={runDirectorySection}
              filesFooter={runFilesSection}
              runDetails={metadataSection}
            />
          ) : <>
          {metadataSection}
          {runDirectorySection}
          {outcomeSection}
          {statusSection}
          {runFilesSection}
          </>}
        </Box>
      </Box>
    </Page>
  );
}
