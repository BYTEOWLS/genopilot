import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {Alert} from '@inkjs/ui';
import {LiveOutputBuffer} from '../../live-output.js';
import {
  applyRunEvent,
  initialRunProgress,
  readAppendedRunEvents,
  RunEventReader,
  type RunProgress,
  type StageProgress,
} from '../../workflows/run-events.js';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import {loadWorkflowResult, type LoadedWorkflowResult} from '../../workflows/results.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {LiveLog} from '../live-log.js';
import {RunResultsScreen} from '../run-results-screen/screen.js';
import {mutedColor} from '../theme.js';
import {useTerminalTitle, type TerminalTitleStatus} from '../terminal-title.js';
import {useHomeSuspension} from '../home-navigation.js';

// Lines kept in memory so the researcher can scroll back through a long run. Complete output
// always remains on disk regardless of this cap; see the run's stdout/stderr log files.
const maximumRetainedLogLines = 5000;
const eventPollIntervalMs = 250;
// Rows this screen uses around the log window: the status alert (3), the log's own margin,
// border, title, scroll markers and footer (7), up to three failure lines (stage failure,
// process error, exit code), and the footer hint. The stage list varies per workflow and is
// measured separately. Space taken by an outer wrapper, such as the welcome screen's own header
// and footer, is not visible here and is not reserved.
const reservedChromeLines = 14;
const minimumVisibleLogLines = 5;

export type WorkflowProgressStage = {id: string; label: string; rules?: readonly string[]};

const stateMarkers: Record<StageProgress['state'], {marker: string; color?: string}> = {
  pending: {marker: '·'},
  running: {marker: '●', color: 'cyan'},
  completed: {marker: '✔', color: 'green'},
  failed: {marker: '✖', color: 'red'},
  'up-to-date': {marker: '✔'},
  'not-implemented': {marker: '—'},
};

function stageDetail(stage: StageProgress): string {
  if (stage.state === 'not-implemented') {
    return 'not implemented';
  }
  if (stage.state === 'up-to-date') {
    return 'up to date';
  }
  return `${String(stage.done)}/${String(stage.total)}`;
}

/** Renders stage state from structured events; console text is never read as workflow state. */
function StageProgressList({progress}: {progress: RunProgress}): React.JSX.Element {
  const width = Math.max(...progress.stages.map(stage => stage.label.length), 0);
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>Stages</Text>
      {progress.stages.map(stage => {
        const {marker, color} = stateMarkers[stage.state];
        return (
          <Text key={stage.id} color={stage.state === 'pending' ? mutedColor : color}>
            {marker} {sanitizeTerminalText(stage.label.padEnd(width))} {stageDetail(stage)}
          </Text>
        );
      })}
      <Text color={mutedColor}>
        {progress.planned
          ? `${String(progress.done)}/${String(progress.total)} jobs`
          : 'Waiting for Snakemake to schedule jobs…'}
      </Text>
    </Box>
  );
}

function hasSucceeded(finished: FinishedExecution): boolean {
  return finished.exitCode === 0 && !finished.error;
}

/**
 * Marks the terminal title while Snakemake runs and keeps the outcome there afterwards, so a run
 * that finished in a background tab is recognizable without switching to it.
 */
function terminalTitleStatus(
  screen: ExecutionState<WorkflowRun>,
): TerminalTitleStatus | undefined {
  switch (screen.state) {
    case 'running':
      return 'running';
    case 'finished':
      return hasSucceeded(screen) ? 'succeeded' : 'failed';
    case 'result':
      return hasSucceeded(screen.finished) ? 'succeeded' : 'failed';
    default:
      return undefined;
  }
}

export type WorkflowRunMode = 'dry-run' | 'execute';

/** The presentation-level shape of a prepared run; the transport details stay in `execution.ts`. */
export type WorkflowRun = {
  mode: WorkflowRunMode;
  command: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  /** Where the run appends its structured progress events; absent for a dry run. */
  eventsPath?: string;
};

export type WorkflowRunResult = WorkflowRun & {exitCode: number | null};

export type WorkflowRunPreparer<R extends WorkflowRun> = (mode: WorkflowRunMode) => R;

export type WorkflowRunExecutor<R extends WorkflowRun> = (
  run: R,
  onOutput: (output: {stream: 'stdout' | 'stderr'; text: string}) => void,
  signal: AbortSignal,
) => Promise<WorkflowRunResult>;

export type WorkflowExecutionOutcome = {
  succeeded: boolean;
  exitCode?: number | null;
  error?: string;
  stdoutLogPath: string;
  stderrLogPath: string;
};

export type WorkflowResultHandoff = {
  runDirectory: string;
  manifest: WorkflowManifest;
  loadResult?: typeof loadWorkflowResult;
};

type PersistedRunResult = {
  loaded: LoadedWorkflowResult;
  outcome: WorkflowExecutionOutcome;
  handoff: Pick<WorkflowResultHandoff, 'runDirectory' | 'manifest'>;
};

type FinishedExecution = {
  state: 'finished';
  run: WorkflowRun;
  logLines: string[];
  exitCode?: number | null;
  error?: string;
  // Present once a finished execution's persisted results are loaded and can be opened.
  result?: PersistedRunResult;
};

type ExecutionState<R extends WorkflowRun> =
  | {state: 'ready'; mode: WorkflowRunMode}
  | {state: 'running'; run: R; logLines: string[]}
  | FinishedExecution
  | {state: 'result'; finished: FinishedExecution & {result: PersistedRunResult}};

const modeOptions: readonly {mode: WorkflowRunMode; label: string; description: string}[] = [
  {
    mode: 'dry-run',
    label: 'Dry run',
    description: 'Preview the jobs Snakemake would execute without producing results.',
  },
  {
    mode: 'execute',
    label: 'Run workflow',
    description: 'Execute the jobs and write results into the run directory.',
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a saved run through the managed Snakemake runtime and follows its output.
 *
 * A dry run and an execution are independent choices rather than a fixed sequence: previewing
 * jobs is valuable while a workflow is still being developed, but a researcher running a
 * released, stable workflow should not have to dry-run it first.
 */
export function WorkflowExecutionScreen<R extends WorkflowRun>({
  configurationPath,
  prepareRun,
  executeRun,
  onBack,
  inputActive,
  stages = [],
  readEvents = readAppendedRunEvents,
  resultHandoff,
}: {
  configurationPath: string;
  prepareRun: WorkflowRunPreparer<R>;
  executeRun: WorkflowRunExecutor<R>;
  onBack: () => void;
  inputActive: boolean;
  stages?: readonly WorkflowProgressStage[];
  readEvents?: typeof readAppendedRunEvents;
  resultHandoff?: WorkflowResultHandoff;
}): React.JSX.Element {
  const [screen, setScreen] = useState<ExecutionState<R>>({state: 'ready', mode: 'dry-run'});
  useTerminalTitle({status: terminalTitleStatus(screen)});
  // Leaving would unmount the screen and abort Snakemake without waiting for its cleanup.
  useHomeSuspension(screen.state === 'running' ? 'busy' : undefined);
  const [progress, setProgress] = useState<RunProgress>(() => initialRunProgress([...stages]));
  // Lines back from the newest; 0 follows the output as it arrives.
  const [scrollOffset, setScrollOffset] = useState(0);
  // Every visit to the mode chooser re-prepares both commands so a second attempt in the same
  // run directory gets its own timestamped log files instead of colliding with the first.
  const [attempt, setAttempt] = useState(0);
  const abortController = useRef<AbortController | undefined>(undefined);
  const liveOutput = useRef<LiveOutputBuffer | undefined>(undefined);
  // Read from callbacks that must not be re-created when a caller passes fresh literals.
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const readEventsRef = useRef(readEvents);
  readEventsRef.current = readEvents;
  const eventReader = useRef(new RunEventReader());
  const eventOffset = useRef(0);
  const jobStages = useRef(new Map<number, string>());

  useEffect(() => () => abortController.current?.abort(), []);

  // Held in a ref because callers pass an inline arrow: a plain dependency on `prepareRun`
  // would re-prepare on every render, and each preparation stamps fresh log-file names, so the
  // paths on screen would drift away from the ones the next Enter actually uses.
  const prepareRunRef = useRef(prepareRun);
  prepareRunRef.current = prepareRun;
  const {rows: terminalRows} = useWindowSize();
  const preparedRuns = useMemo(
    () => ({
      'dry-run': prepareRunRef.current('dry-run'),
      execute: prepareRunRef.current('execute'),
    }),
    [attempt],
  );

  /** Applies everything appended to the event file since the last read. */
  const drainEvents = useCallback(async (eventsPath: string | undefined): Promise<void> => {
    if (!eventsPath) {
      return;
    }
    try {
      const appended = await readEventsRef.current(
        eventsPath,
        eventOffset.current,
        eventReader.current,
      );
      eventOffset.current = appended.offset;
      if (appended.events.length > 0) {
        setProgress(current =>
          appended.events.reduce(
            (state, event) => applyRunEvent(state, event, jobStages.current, [...stagesRef.current]),
            current,
          ),
        );
      }
    } catch {
      // Following progress must never interfere with the run itself; the complete Snakemake
      // logs remain on disk either way.
    }
  }, []);

  const runningEventsPath = screen.state === 'running' ? screen.run.eventsPath : undefined;
  useEffect(() => {
    if (!runningEventsPath) {
      return;
    }
    const timer = setInterval(() => {
      void drainEvents(runningEventsPath);
    }, eventPollIntervalMs);
    return () => clearInterval(timer);
  }, [runningEventsPath, drainEvents]);

  const loadPersistedResult = async (): Promise<LoadedWorkflowResult> => {
    if (!resultHandoff) {
      throw new Error('Result handoff is not configured.');
    }
    try {
      return await (resultHandoff.loadResult ?? loadWorkflowResult)(
        resultHandoff.runDirectory,
        resultHandoff.manifest,
      );
    } catch (error) {
      return {
        kind: 'incompatible',
        error: {
          kind: 'invalid-summary',
          message: `Persisted results could not be loaded: ${errorMessage(error)}`,
        },
      };
    }
  };

  const start = (mode: WorkflowRunMode): void => {
    const run = preparedRuns[mode];
    const controller = new AbortController();
    abortController.current = controller;
    eventReader.current = new RunEventReader();
    eventOffset.current = 0;
    jobStages.current = new Map();
    setScrollOffset(0);
    setProgress(initialRunProgress([...stagesRef.current]));
    setScreen({state: 'running', run, logLines: []});
    liveOutput.current = new LiveOutputBuffer(lines => {
      setScreen(current =>
        current.state === 'running'
          ? {...current, logLines: [...current.logLines, ...lines].slice(-maximumRetainedLogLines)}
          : current,
      );
      // The offset counts back from the newest line, so arriving output would otherwise drag
      // the view forward while it is being read. Holding a scrolled position means moving the
      // offset with the new lines; following (offset 0) stays pinned to the end.
      setScrollOffset(current => (current === 0 ? 0 : current + lines.length));
    });
    executeRun(
      run,
      output => liveOutput.current?.append(output.stream, output.text),
      controller.signal,
    ).then(
      async result => {
        liveOutput.current?.flush();
        // The last events can land after the final poll, so drain once more before settling.
        await drainEvents(run.eventsPath);
        const persisted =
          run.mode === 'execute' && resultHandoff
            ? {
                loaded: await loadPersistedResult(),
                handoff: resultHandoff,
                outcome: {
                  succeeded: result.exitCode === 0,
                  exitCode: result.exitCode,
                  stdoutLogPath: result.stdoutLogPath,
                  stderrLogPath: result.stderrLogPath,
                },
              }
            : undefined;
        setScreen(current => ({
          state: 'finished',
          run: result,
          logLines: current.state === 'running' ? current.logLines : [],
          exitCode: result.exitCode,
          ...(persisted ? {result: persisted} : {}),
        }));
      },
      async error => {
        liveOutput.current?.flush();
        await drainEvents(run.eventsPath);
        const message = errorMessage(error);
        const persisted =
          run.mode === 'execute' && resultHandoff
            ? {
                loaded: await loadPersistedResult(),
                handoff: resultHandoff,
                outcome: {
                  succeeded: false,
                  error: message,
                  stdoutLogPath: run.stdoutLogPath,
                  stderrLogPath: run.stderrLogPath,
                },
              }
            : undefined;
        setScreen(current => ({
          state: 'finished',
          run,
          logLines: current.state === 'running' ? current.logLines : [],
          error: message,
          ...(persisted ? {result: persisted} : {}),
        }));
      },
    );
  };

  const returnToModes = (mode: WorkflowRunMode): void => {
    setAttempt(current => current + 1);
    setScreen({state: 'ready', mode});
  };

  const logLines = screen.state === 'running' || screen.state === 'finished' ? screen.logLines : [];
  const visibleLogLines = Math.max(
    minimumVisibleLogLines,
    terminalRows - reservedChromeLines -
      (screen.state === 'running' || screen.state === 'finished' ? progress.stages.length : 0),
  );
  // Scrolling is clamped to what is actually behind the window, so the view can never be
  // parked past the start of the retained output.
  const maximumScrollOffset = Math.max(0, logLines.length - visibleLogLines);
  // Clamped on the way out rather than in state: the retained buffer is trimmed as the run
  // grows, so a held position can fall off the start of what is still kept.
  const effectiveScrollOffset = Math.min(scrollOffset, maximumScrollOffset);
  const scroll = (byLines: number): void => {
    setScrollOffset(Math.min(maximumScrollOffset, Math.max(0, effectiveScrollOffset + byLines)));
  };

  useInput(
    (input, key) => {
      // Scrolling the log stays available while the workflow runs and after it finishes; it
      // never starts, stops, or otherwise affects the process.
      if (screen.state === 'running' || screen.state === 'finished') {
        if (key.upArrow) {
          scroll(1);
          return;
        }
        if (key.downArrow) {
          scroll(-1);
          return;
        }
        if (key.pageUp) {
          scroll(visibleLogLines);
          return;
        }
        if (key.pageDown) {
          scroll(-visibleLogLines);
          return;
        }
        if (input === 'g') {
          setScrollOffset(maximumScrollOffset);
          return;
        }
        if (input === 'G') {
          setScrollOffset(0);
          return;
        }
      }
      if (screen.state === 'running' || screen.state === 'result') {
        return;
      }
      if (screen.state === 'finished') {
        // The run stays on screen after it finishes; the researcher decides when to open its
        // persisted results.
        if (key.return && screen.result) {
          setScreen({state: 'result', finished: {...screen, result: screen.result}});
          return;
        }
        if (!key.escape) {
          return;
        }
        // A finished dry run is a step towards executing, so Esc offers the mode chooser again
        // with the execution preselected. A finished execution has nothing left to choose.
        if (screen.run.mode === 'dry-run') {
          returnToModes('execute');
        } else {
          onBack();
        }
        return;
      }
      if (key.escape) {
        onBack();
      } else if (key.upArrow || key.downArrow || input === ' ') {
        const offset = key.upArrow ? -1 : 1;
        const currentIndex = modeOptions.findIndex(option => option.mode === screen.mode);
        const option = modeOptions[(currentIndex + offset + modeOptions.length) % modeOptions.length];
        if (option) {
          setScreen({state: 'ready', mode: option.mode});
        }
      } else if (key.return) {
        start(screen.mode);
      }
    },
    {isActive: inputActive},
  );

  if (screen.state === 'result') {
    const {result} = screen.finished;
    return (
      <RunResultsScreen
        runDirectory={result.handoff.runDirectory}
        manifest={result.handoff.manifest}
        loaded={result.loaded}
        executionOutcome={result.outcome}
        onBack={() => setScreen(screen.finished)}
        inputActive={inputActive}
      />
    );
  }

  if (screen.state === 'ready') {
    const run = preparedRuns[screen.mode];
    return (
      <Box flexDirection="column">
        <Alert variant="info">Configuration saved. Choose how to start this run.</Alert>
        <Text>{sanitizeTerminalText(configurationPath)}</Text>
        <Box marginTop={1} flexDirection="column">
          {modeOptions.map(option => {
            const selected = option.mode === screen.mode;
            return (
              <Box key={option.mode} flexDirection="column">
                <Text color={selected ? 'cyan' : undefined}>
                  {selected ? '›' : ' '} ({selected ? '●' : ' '}) {option.label}
                </Text>
                <Text color={mutedColor} wrap="wrap">
                  {'      '}
                  {option.description}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Snakemake command</Text>
          <Text wrap="wrap">{sanitizeTerminalText(run.command)}</Text>
        </Box>
        <Text color={mutedColor}>↑/↓ — Choose · Enter — Start · Esc — Back to workflow</Text>
      </Box>
    );
  }

  const finished = screen.state === 'finished';
  const error = finished ? screen.error : undefined;
  const exitCode = finished ? screen.exitCode : undefined;
  const succeeded = finished && hasSucceeded(screen);
  const label = screen.run.mode === 'dry-run' ? 'Snakemake dry run' : 'Workflow run';
  return (
    <Box flexDirection="column">
      {finished ? (
        <Alert variant={succeeded ? 'success' : 'error'}>
          {succeeded ? `${label} succeeded.` : `${label} failed.`}
        </Alert>
      ) : (
        <Text bold color="cyan">Running {sanitizeTerminalText(label.toLowerCase())}…</Text>
      )}
      {screen.run.eventsPath ? <StageProgressList progress={progress} /> : null}
      <LiveLog
        title={
          effectiveScrollOffset > 0
            ? `Snakemake log — line ${String(Math.max(1, logLines.length - effectiveScrollOffset - visibleLogLines + 1))}–${String(logLines.length - effectiveScrollOffset)} of ${String(logLines.length)}`
            : 'Snakemake log'
        }
        lines={logLines}
        emptyMessage="Waiting for output…"
        visibleLines={visibleLogLines}
        scrollOffset={effectiveScrollOffset}
        footer={
          maximumScrollOffset > 0
            ? '↑/↓ — Scroll · PageUp/PageDown (or fn + ↑/↓) — Page · g — Oldest · G — Follow newest'
            : undefined
        }
      />
      {progress.failureMessage ? (
        <Text color="red">{sanitizeTerminalText(progress.failureMessage)}</Text>
      ) : null}
      {error ? <Text color="red">{sanitizeTerminalText(error)}</Text> : null}
      {finished && exitCode !== undefined && exitCode !== null && exitCode !== 0 ? (
        <Text color="red">Snakemake exited with code {String(exitCode)}.</Text>
      ) : null}
      {finished ? (
        <Text color={mutedColor}>
          {screen.run.mode === 'dry-run'
            ? 'Esc — Start options'
            : `${screen.result ? 'Enter — View results · ' : ''}Esc — Back to workflow`}
        </Text>
      ) : (
        <Text color={mutedColor}>Do not close this terminal.</Text>
      )}
    </Box>
  );
}
