import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {lstat, stat} from 'node:fs/promises';
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {delimiter, dirname, join} from 'node:path';
import {acquireFileLock, type FileLock} from '../file-lock.js';
import {LiveOutputBuffer} from '../live-output.js';
import {toolingPolicy} from './policy.js';
import {
  resolveToolingPaths,
  selectPixiDownload,
  type ToolingPaths,
} from './paths.js';

export type InstallationPhase = 'pixi' | 'runtime' | 'verification';

export type InstallationProgress =
  | {
      type: 'phase';
      phase: InstallationPhase;
      tools: readonly ('pixi' | 'conda' | 'snakemake')[];
    }
  | {type: 'log'; text: string};

export type InstallationResult = {
  logPath: string;
  paths: ToolingPaths;
};

export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type InstallerDependencies = {
  downloadFile: (
    url: string,
    destination: string,
    maximumBytes: number,
    signal?: AbortSignal,
  ) => Promise<{sha256: string; bytes: number}>;
  runProcess: (
    command: string,
    arguments_: readonly string[],
    environment: NodeJS.ProcessEnv,
    onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void | Promise<void>,
    signal?: AbortSignal,
  ) => Promise<ProcessResult>;
  resolvePaths: () => ToolingPaths;
  now: () => Date;
  randomId: () => string;
};

export class ToolingInstallationError extends Error {
  constructor(
    message: string,
    readonly logPath: string,
  ) {
    super(message);
    this.name = 'ToolingInstallationError';
  }
}

const processTailCharacters = 64 * 1024;
const forcedTerminationDelayMilliseconds = 5000;
const trustedTarExecutables = ['/usr/bin/tar', '/bin/tar'] as const;

function terminateProcessGroup(
  child: {pid?: number; kill: (signal?: NodeJS.Signals) => boolean},
  signal: NodeJS.Signals,
): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if its process group has already disappeared.
    }
  }
  child.kill(signal);
}

function appendTail(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length > processTailCharacters
    ? combined.slice(-processTailCharacters)
    : combined;
}

function approvedDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !toolingPolicy.pixi.allowedDownloadHosts.includes(
      url.hostname as (typeof toolingPolicy.pixi.allowedDownloadHosts)[number],
    )
  ) {
    throw new Error(`Unapproved Pixi download location: ${url.origin}`);
  }
  return url;
}

async function downloadFile(
  url: string,
  destination: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<{sha256: string; bytes: number}> {
  approvedDownloadUrl(url);
  const timeoutSignal = AbortSignal.timeout(300_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {redirect: 'follow', signal: combinedSignal});
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }
  approvedDownloadUrl(response.url);
  if (!response.body) {
    throw new Error('Pixi download returned an empty response body.');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Pixi download exceeds the ${maximumBytes}-byte size limit.`);
  }

  const file = await open(destination, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(`Pixi download exceeds the ${maximumBytes}-byte size limit.`);
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const {bytesWritten} = await file.write(chunk, offset, chunk.byteLength - offset);
        if (bytesWritten === 0) {
          throw new Error('Could not finish writing the Pixi download.');
        }
        offset += bytesWritten;
      }
      hash.update(chunk);
    }
  } catch (error) {
    await file.close();
    await rm(destination, {force: true});
    throw error;
  }
  await file.close();
  return {sha256: hash.digest('hex'), bytes};
}

function runProcess(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  onOutput: (
    stream: 'stdout' | 'stderr',
    chunk: string,
  ) => void | Promise<void> = () => undefined,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Tooling setup cancelled.'));
      return;
    }

    const child = spawn(command, [...arguments_], {
      detached: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let outputWrites = Promise.resolve();
    let outputError: unknown;

    const terminate = (): void => {
      terminateProcessGroup(child, 'SIGTERM');
      killTimer ??= setTimeout(
        () => terminateProcessGroup(child, 'SIGKILL'),
        forcedTerminationDelayMilliseconds,
      );
    };

    const collectOutput = (
      stream: 'stdout' | 'stderr',
      value: string,
      pause: () => void,
      resume: () => void,
    ): void => {
      if (stream === 'stdout') {
        stdout = appendTail(stdout, value);
      } else {
        stderr = appendTail(stderr, value);
      }
      pause();
      outputWrites = outputWrites
        .then(() => onOutput(stream, value))
        .catch((error: unknown) => {
          outputError ??= error;
          terminate();
        })
        .finally(resume);
    };

    child.stdout.on('data', chunk => {
      collectOutput(
        'stdout',
        String(chunk),
        () => child.stdout.pause(),
        () => child.stdout.resume(),
      );
    });
    child.stderr.on('data', chunk => {
      collectOutput(
        'stderr',
        String(chunk),
        () => child.stderr.pause(),
        () => child.stderr.resume(),
      );
    });

    signal?.addEventListener('abort', terminate, {once: true});

    child.on('error', reject);
    child.on('close', code => {
      void outputWrites.then(() => {
        if (killTimer) {
          clearTimeout(killTimer);
        }
        signal?.removeEventListener('abort', terminate);
        if (signal?.aborted) {
          reject(new Error('Tooling setup cancelled.'));
        } else if (outputError) {
          reject(outputError);
        } else {
          resolve({code, stdout, stderr});
        }
      });
    });
  });
}

const defaultDependencies: InstallerDependencies = {
  downloadFile,
  runProcess,
  resolvePaths: resolveToolingPaths,
  now: () => new Date(),
  randomId: randomUUID,
};

function timestamp(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function commandForLog(command: string, arguments_: readonly string[]): string {
  return [command, ...arguments_.map(value => JSON.stringify(value))].join(' ');
}

function detectedVersion(output: string): string | undefined {
  return output.match(/(?:^|[^\d])v?(\d+\.\d+(?:\.\d+)?)/)?.[1];
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, {recursive: true, mode: 0o700});
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Managed tooling path is not a safe directory: ${path}`);
  }
  await chmod(path, 0o700);
}

async function selectTrustedTarExecutable(): Promise<string> {
  for (const path of trustedTarExecutables) {
    try {
      const details = await stat(path);
      if (details.isFile() && (details.mode & 0o111) !== 0) {
        return path;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  throw new Error(`A trusted tar executable was not found at ${trustedTarExecutables.join(' or ')}.`);
}

function minimalEnvironment(paths: ToolingPaths): NodeJS.ProcessEnv {
  const inheritedNames = [
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of inheritedNames) {
    if (process.env[name] !== undefined) {
      environment[name] = process.env[name];
    }
  }
  environment.PATH = [paths.managedBinDirectory, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(
    delimiter,
  );
  environment.PIXI_HOME = paths.pixiHome;
  environment.PIXI_NO_CONFIG = '1';
  return environment;
}

/** Installs the managed runtime after the caller has obtained explicit consent. */
export async function installTooling(
  onProgress: (progress: InstallationProgress) => void = () => undefined,
  signal?: AbortSignal,
  dependencies: InstallerDependencies = defaultDependencies,
): Promise<InstallationResult> {
  const paths = dependencies.resolvePaths();
  const download = selectPixiDownload(paths);
  await ensurePrivateDirectory(paths.dataDirectory);
  await ensurePrivateDirectory(paths.logsDirectory);
  await ensurePrivateDirectory(paths.temporaryDirectory);
  await ensurePrivateDirectory(dirname(paths.pixiExecutable));

  const logPath = join(
    paths.logsDirectory,
    `tooling-setup-${timestamp(dependencies.now())}-${dependencies.randomId()}.log`,
  );
  await writeFile(logPath, '', {encoding: 'utf8', flag: 'wx', mode: 0o600});

  let logFailure: unknown;
  const log = async (message: string, liveText?: string): Promise<void> => {
    try {
      await appendFile(logPath, `${message}\n`, 'utf8');
    } catch (error) {
      logFailure ??= error;
      throw error;
    }
    if (liveText) {
      onProgress({type: 'log', text: liveText});
    }
  };
  const tryLog = async (message: string): Promise<void> => {
    try {
      await log(message);
    } catch {
      // Preserve the installation failure when its diagnostic log cannot be updated.
    }
  };

  let workingDirectory: string | undefined;
  let lock: FileLock | undefined;
  const runLogged = async (
    command: string,
    arguments_: readonly string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<ProcessResult> => {
    await log(`$ ${commandForLog(command, arguments_)}`);
    let streamedOutput = false;
    const liveOutput = new LiveOutputBuffer(lines => {
      onProgress({type: 'log', text: lines.join('\n')});
    });

    const result = await dependencies.runProcess(
      command,
      arguments_,
      environment,
      async (stream, chunk) => {
        streamedOutput = true;
        await log(`[${stream}]\n${chunk}`);
        liveOutput.append(stream, chunk);
      },
      signal,
    );
    liveOutput.flush();
    if (!streamedOutput && result.stdout) {
      await log(`[stdout] ${result.stdout.trimEnd()}`, result.stdout);
    }
    if (!streamedOutput && result.stderr) {
      await log(`[stderr] ${result.stderr.trimEnd()}`, result.stderr);
    }
    await log(`[exit] ${String(result.code)}`);
    return result;
  };

  try {
    lock = await acquireFileLock(paths.installationLockPath, 'Tooling setup is already running.');
    if (lock.recovered) {
      await log('Recovered a stale tooling setup lock.');
    }
    const trustedTarExecutable = await selectTrustedTarExecutable();

    workingDirectory = await mkdtemp(join(paths.temporaryDirectory, 'setup-'));
    const archivePath = join(workingDirectory, 'pixi.tar.gz');
    const extractionDirectory = join(workingDirectory, 'extracted');
    onProgress({type: 'phase', phase: 'pixi', tools: ['pixi']});
    await log(`Installing tooling in ${paths.dataDirectory}`, 'Preparing Pixi installation…');
    await log(`Downloading ${download.url}`, 'Downloading Pixi…');
    const downloaded = await dependencies.downloadFile(
      download.url,
      archivePath,
      toolingPolicy.pixi.maximumDownloadBytes,
      signal,
    );
    await log(`Downloaded bytes: ${String(downloaded.bytes)}`, 'Pixi download complete.');
    await log(`Expected SHA-256: ${download.sha256}`);
    await log(`Actual SHA-256:   ${downloaded.sha256}`);
    if (downloaded.sha256 !== download.sha256) {
      throw new Error('Pixi download checksum verification failed.');
    }

    const safeEnvironment = minimalEnvironment(paths);
    const listing = await runLogged(trustedTarExecutable, ['-tzf', archivePath], safeEnvironment);
    if (listing.code !== 0 || listing.stdout.trim() !== 'pixi') {
      throw new Error('Pixi archive contains unexpected entries.');
    }

    await ensurePrivateDirectory(extractionDirectory);
    const extraction = await runLogged(
      trustedTarExecutable,
      ['-xzf', archivePath, '-C', extractionDirectory, '--', 'pixi'],
      safeEnvironment,
    );
    if (extraction.code !== 0) {
      throw new Error('Could not extract the Pixi archive.');
    }

    const extractedPixi = join(extractionDirectory, 'pixi');
    const extractedDetails = await lstat(extractedPixi);
    if (!extractedDetails.isFile() || extractedDetails.isSymbolicLink()) {
      throw new Error('Extracted Pixi executable is not a regular file.');
    }
    await chmod(extractedPixi, 0o700);
    await rename(extractedPixi, paths.pixiExecutable);

    onProgress({type: 'phase', phase: 'verification', tools: ['pixi']});
    const pixiVerification = await runLogged(
      paths.pixiExecutable,
      ['--version'],
      safeEnvironment,
    );
    if (
      pixiVerification.code !== 0 ||
      detectedVersion(`${pixiVerification.stdout}\n${pixiVerification.stderr}`) !==
        toolingPolicy.pixi.managedVersion
    ) {
      throw new Error(`Installed tool verification failed for ${paths.pixiExecutable}.`);
    }

    onProgress({type: 'phase', phase: 'runtime', tools: ['conda', 'snakemake']});
    const installArguments = [
      'global',
      'install',
      '--environment',
      toolingPolicy.managedGlobalEnvironment.name,
      ...toolingPolicy.managedGlobalEnvironment.channels.flatMap(channel => [
        '--channel',
        channel,
      ]),
      ...toolingPolicy.managedGlobalEnvironment.packages,
    ];
    const installation = await runLogged(paths.pixiExecutable, installArguments, safeEnvironment);
    if (installation.code !== 0) {
      throw new Error('Pixi could not install Snakemake and Conda.');
    }

    onProgress({type: 'phase', phase: 'verification', tools: ['conda', 'snakemake']});
    for (const [command, expectedVersion] of [
      [paths.condaExecutable, toolingPolicy.conda.managedVersion],
      [paths.snakemakeExecutable, toolingPolicy.snakemake.managedVersion],
    ] as const) {
      const verification = await runLogged(command, ['--version'], safeEnvironment);
      const output = `${verification.stdout}\n${verification.stderr}`;
      if (verification.code !== 0 || detectedVersion(output) !== expectedVersion) {
        throw new Error(`Installed tool verification failed for ${command}.`);
      }
    }

    await log('Tooling installation completed successfully.', 'Tooling installation completed.');
    return {logPath, paths};
  } catch (error) {
    const message = signal?.aborted
      ? 'Tooling setup cancelled.'
      : error instanceof Error
        ? error.message
        : String(error);
    await tryLog(`ERROR: ${message}`);
    const diagnostic = logFailure ? ' The setup log could not be written completely.' : '';
    throw new ToolingInstallationError(`${message}${diagnostic}`, logPath);
  } finally {
    if (workingDirectory) {
      await rm(workingDirectory, {recursive: true, force: true});
    }
    if (lock) {
      await lock.release();
    }
  }
}
