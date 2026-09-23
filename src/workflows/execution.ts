import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, delimiter, join, resolve} from 'node:path';
import {finished} from 'node:stream/promises';
import {readNcbiApiKey} from '../tooling/ncbi-api-key.js';
import {resolveToolingPaths, type ToolingPaths} from '../tooling/paths.js';
import {formatCompactUtcTimestamp} from './timestamps.js';
import {RUN_EVENTS_FILENAME} from './run-events.js';

export type WorkflowOutput = {stream: 'stdout' | 'stderr'; text: string};

/**
 * A dry run previews the jobs Snakemake would schedule; an execution actually runs them.
 * Both are prepared and started the same way, and either can be started on its own: a dry
 * run stays useful for inspecting a workflow, but it is not a precondition for executing a
 * workflow whose contract is already stable.
 */
export type SnakemakeRunMode = 'dry-run' | 'execute';

export type SnakemakeRun = {
  mode: SnakemakeRunMode;
  command: string;
  executable: string;
  arguments: readonly string[];
  runDirectory: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  /** Where the run's structured progress events are appended; absent for a dry run. */
  eventsPath?: string;
};

/**
 * Directory holding the packaged Snakemake logger plugin, resolved relative to the installed
 * application. Snakemake finds logger plugins by scanning `sys.path` for `snakemake_logger_
 * plugin_*` packages, so this directory is exported as `PYTHONPATH`; it holds nothing else and
 * therefore cannot shadow a module in the Conda environments Snakemake provisions for rules.
 */
export const packagedLoggerDirectory = fileURLToPath(
  new URL('../../workflows/shared/logging', import.meta.url),
);

const runEventsLoggerName = 'genopilot-run-events';

export type SnakemakeRunResult = SnakemakeRun & {exitCode: number | null};

export function snakemakeRunModeLabel(mode: SnakemakeRunMode): string {
  return mode === 'dry-run' ? 'dry run' : 'run';
}

export type WorkflowProcessSpawner = (
  command: string,
  arguments_: readonly string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcessWithoutNullStreams;

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderCommand(executable: string, arguments_: readonly string[]): string {
  return [executable, ...arguments_].map(shellQuote).join(' ');
}

/**
 * Builds the reproducible managed-runtime command without starting a process.
 *
 * Log file names carry the mode and the attempt's start time because a run directory can hold
 * several attempts — a dry run and an execution, or a retry after a failure — and none of them
 * may overwrite an earlier attempt's preserved output.
 */
export function prepareSnakemakeRun({
  mode,
  runDirectory,
  configurationPath,
  snakefilePath,
  cores,
  paths = resolveToolingPaths(),
  startedAt = new Date(),
}: {
  mode: SnakemakeRunMode;
  runDirectory: string;
  configurationPath: string;
  snakefilePath: string;
  cores: number;
  paths?: ToolingPaths;
  startedAt?: Date;
}): SnakemakeRun {
  const directory = resolve(runDirectory);
  // Only a real execution records progress events: a dry run schedules nothing, and its
  // preview must not be mixed into the run's record of what actually happened.
  const eventsPath = mode === 'execute' ? join(directory, RUN_EVENTS_FILENAME) : undefined;
  const arguments_ = [
    '--snakefile',
    resolve(snakefilePath),
    '--directory',
    directory,
    '--configfile',
    resolve(configurationPath),
    '--cores',
    String(cores),
    '--use-conda',
    // Without this, Snakemake provisions a private copy of every pinned rule environment
    // inside each run's own `.snakemake/`, which for this workflow is roughly 600 MB per run.
    // The rest of `.snakemake/` stays per-run: its job metadata is keyed by relative output
    // path, so sharing it would have every run overwrite the previous run's records.
    '--conda-prefix',
    paths.condaEnvironmentsDirectory,
    '--printshellcmds',
    ...(mode === 'dry-run' ? ['--dry-run'] : []),
    ...(eventsPath
      ? ['--logger', runEventsLoggerName, `--logger-${runEventsLoggerName}-path`, eventsPath]
      : []),
  ];
  const logPrefix = join(
    directory,
    'logs',
    `snakemake-${mode}.${formatCompactUtcTimestamp(startedAt)}`,
  );
  return {
    mode,
    executable: paths.snakemakeExecutable,
    arguments: arguments_,
    command: renderCommand(paths.snakemakeExecutable, arguments_),
    runDirectory: directory,
    stdoutLogPath: `${logPrefix}.stdout.log`,
    stderrLogPath: `${logPrefix}.stderr.log`,
    ...(eventsPath ? {eventsPath} : {}),
  };
}

function terminateProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already have exited; fall back to the direct child.
    }
  }
  child.kill(signal);
}

/** Executes a prepared run while preserving both complete output streams. */
export async function executeSnakemakeRun(
  prepared: SnakemakeRun,
  onOutput: (output: WorkflowOutput) => void = () => undefined,
  signal?: AbortSignal,
  {
    paths = resolveToolingPaths(),
    spawnProcess = spawn as WorkflowProcessSpawner,
    readApiKey = readNcbiApiKey,
    loggerDirectory = packagedLoggerDirectory,
  }: {
    paths?: ToolingPaths;
    spawnProcess?: WorkflowProcessSpawner;
    readApiKey?: (path: string) => Promise<string | undefined>;
    loggerDirectory?: string;
  } = {},
): Promise<SnakemakeRunResult> {
  const cancelled = (): Error =>
    new Error(`Snakemake ${snakemakeRunModeLabel(prepared.mode)} cancelled.`);
  if (signal?.aborted) {
    throw cancelled();
  }
  await mkdir(dirname(prepared.stdoutLogPath), {recursive: true, mode: 0o700});
  const apiKey = await readApiKey(paths.ncbiApiKeyPath);
  const environment: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: [paths.managedBinDirectory, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    PIXI_HOME: paths.pixiHome,
    ...(prepared.eventsPath ? {PYTHONPATH: loggerDirectory} : {}),
    ...(apiKey ? {NCBI_API_KEY: apiKey} : {}),
  };
  const stdoutFile = await open(prepared.stdoutLogPath, 'wx', 0o600);
  let stderrFile;
  try {
    stderrFile = await open(prepared.stderrLogPath, 'wx', 0o600);
  } catch (error) {
    await stdoutFile.close();
    throw error;
  }
  const stdoutLog = stdoutFile.createWriteStream();
  const stderrLog = stderrFile.createWriteStream();
  let child: ChildProcessWithoutNullStreams | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let logError: unknown;
  const cancel = (): void => {
    if (!child) {
      return;
    }
    terminateProcess(child, 'SIGTERM');
    forceTimer ??= setTimeout(() => terminateProcess(child as ChildProcessWithoutNullStreams, 'SIGKILL'), 5000);
  };
  const handleLogError = (error: unknown): void => {
    logError ??= error;
    cancel();
  };
  // Attach error handling before spawning so a filesystem failure cannot become an unhandled
  // stream error or leave a detached Snakemake process running.
  const logCompletions = [
    finished(stdoutLog).catch(handleLogError),
    finished(stderrLog).catch(handleLogError),
  ];

  try {
    child = spawnProcess(prepared.executable, prepared.arguments, {
      cwd: prepared.runDirectory,
      detached: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    stdoutLog.end();
    stderrLog.end();
    await Promise.all(logCompletions);
    throw error;
  }
  if (logError) {
    cancel();
  }

  child.stdout.on('data', chunk => {
    const text = String(chunk);
    stdoutLog.write(text);
    onOutput({stream: 'stdout', text});
  });
  child.stderr.on('data', chunk => {
    const text = String(chunk);
    stderrLog.write(text);
    onOutput({stream: 'stderr', text});
  });

  // AbortSignal does not replay an abort event to a listener added after cancellation.
  if (signal?.aborted) {
    cancel();
  } else {
    signal?.addEventListener('abort', cancel, {once: true});
  }

  let exitCode: number | null = null;
  let processError: unknown;
  try {
    exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child?.once('error', reject);
      child?.once('close', resolveExit);
    });
  } catch (error) {
    processError = error;
  } finally {
    if (forceTimer) {
      clearTimeout(forceTimer);
    }
    signal?.removeEventListener('abort', cancel);
    stdoutLog.end();
    stderrLog.end();
    await Promise.all(logCompletions);
  }
  if (signal?.aborted) {
    throw cancelled();
  }
  if (logError) {
    throw logError;
  }
  if (processError) {
    throw processError;
  }
  return {...prepared, exitCode};
}
