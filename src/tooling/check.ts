import {spawn} from 'node:child_process';
import {delimiter, dirname} from 'node:path';
import {toolingPolicy} from './policy.js';
import {resolveToolingPaths, type ToolingPaths} from './paths.js';

export type DetectedTool = {
  command: string;
  version: string;
};

export type ToolCheckResult =
  | {state: 'available'; detected: DetectedTool}
  | {state: 'installing'}
  | {state: 'verifying'}
  | {state: 'missing'}
  | {state: 'failed'; message: string}
  | {state: 'incompatible'; detected: DetectedTool; supportedRange: string};

type CompletedToolingCheck = {
  node: ToolCheckResult;
  pixi: ToolCheckResult;
  conda: ToolCheckResult;
  snakemake: ToolCheckResult;
  python: ToolCheckResult;
};

export type ToolingStatus =
  | {state: 'checking'}
  | {state: 'check-failed'; message: string}
  | (CompletedToolingCheck & {state: 'installing'})
  | (CompletedToolingCheck & {state: 'ready'})
  | (CompletedToolingCheck & {state: 'setup-required'});

type ComparableVersion = readonly [major: number, minor: number, patch: number];

type VersionProbeResult =
  | {state: 'detected'; detected: DetectedTool}
  | {state: 'missing'}
  | {state: 'failed'; message: string};

const checkTimeoutMilliseconds = 3000;
const maximumVersionOutputCharacters = 64 * 1024;

/**
 * Returns the first non-empty version line produced by a command.
 * Tool version commands sometimes write to stdout and sometimes to stderr, so
 * their combined output is normalized before this helper is called.
 */
function firstOutputLine(output: string): string {
  return output.trim().split(/\r?\n/, 1)[0] ?? '';
}

/** Extracts a numeric major/minor/patch tuple from typical `--version` output. */
function parseVersion(output: string): ComparableVersion | undefined {
  const match = output.match(/(?:^|[^\d])v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Compares two version tuples using semantic major, minor, and patch order. */
function compareVersions(left: ComparableVersion, right: ComparableVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/** Formats the inclusive-minimum and exclusive-maximum policy convention. */
function supportedRange(minimumVersion: string, maximumVersionExclusive: string): string {
  return `>=${minimumVersion} <${maximumVersionExclusive}`;
}

/** Checks detected version output against an inclusive/exclusive policy range. */
export function isVersionSupported(
  versionOutput: string,
  minimumVersion: string,
  maximumVersionExclusive: string,
): boolean {
  const detected = parseVersion(versionOutput);
  const minimum = parseVersion(minimumVersion);
  const maximum = parseVersion(maximumVersionExclusive);
  if (!detected || !minimum || !maximum) {
    return false;
  }

  return compareVersions(detected, minimum) >= 0 && compareVersions(detected, maximum) < 0;
}

/** Converts a detected command and its policy into a render-friendly result. */
function validateDetectedTool(
  detected: DetectedTool | undefined,
  minimumVersion: string,
  maximumVersionExclusive: string,
): ToolCheckResult {
  if (!detected) {
    return {state: 'missing'};
  }

  if (isVersionSupported(detected.version, minimumVersion, maximumVersionExclusive)) {
    return {state: 'available', detected};
  }

  return {
    state: 'incompatible',
    detected,
    supportedRange: supportedRange(minimumVersion, maximumVersionExclusive),
  };
}

/** Runs `<command> --version` without a shell and retains actionable failures. */
function readVersion(command: string): Promise<VersionProbeResult> {
  return new Promise(resolve => {
    const child = spawn(command, ['--version'], {
      env: {
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        PATH: [dirname(command), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    let settled = false;

    // Error, close, and timeout events can race. Resolve the promise only once.
    const finish = (result: VersionProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    // Collect both streams because tools do not consistently use stdout for versions.
    const collectOutput = (chunk: unknown): void => {
      output += String(chunk);
      if (output.length > maximumVersionOutputCharacters) {
        child.kill();
        finish({state: 'failed', message: 'Version output exceeded the safety limit'});
      }
    };
    child.stdout.on('data', collectOutput);
    child.stderr.on('data', collectOutput);
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ENOENT'
          ? {state: 'missing'}
          : {state: 'failed', message: `Could not execute version check (${error.code ?? 'error'})`},
      );
    });
    child.on('close', code => {
      if (code !== 0) {
        finish({state: 'failed', message: `Version check exited with code ${String(code)}`});
        return;
      }
      const version = firstOutputLine(output);
      finish(
        parseVersion(version)
          ? {state: 'detected', detected: {command, version}}
          : {state: 'failed', message: 'Version output was not recognized'},
      );
    });

    // Do not leave the welcome screen waiting forever for a broken executable.
    const timeout = setTimeout(() => {
      child.kill();
      finish({state: 'failed', message: 'Version check timed out'});
    }, checkTimeoutMilliseconds);
  });
}

async function findCompatibleTool(
  commands: readonly string[],
  minimumVersion: string,
  maximumVersionExclusive: string,
): Promise<ToolCheckResult> {
  let firstUnavailable: ToolCheckResult | undefined;

  for (const command of commands) {
    const probe = await readVersion(command);
    if (probe.state === 'missing') {
      continue;
    }
    if (probe.state === 'failed') {
      firstUnavailable ??= probe;
      continue;
    }
    const result = validateDetectedTool(
      probe.detected,
      minimumVersion,
      maximumVersionExclusive,
    );
    if (result.state === 'available') {
      return result;
    }
    firstUnavailable ??= result;
  }

  return firstUnavailable ?? {state: 'missing'};
}

/**
 * Detects and validates only the application-managed runtime bundle.
 * External PATH tools are intentionally ignored during the limited MVP.
 */
export async function checkTooling(paths: ToolingPaths = resolveToolingPaths()): Promise<ToolingStatus> {
  const [pixi, conda, snakemake, python] = await Promise.all([
    findCompatibleTool(
      [paths.pixiExecutable],
      toolingPolicy.pixi.minimumVersion,
      toolingPolicy.pixi.maximumVersionExclusive,
    ),
    findCompatibleTool(
      [paths.condaExecutable],
      toolingPolicy.conda.minimumVersion,
      toolingPolicy.conda.maximumVersionExclusive,
    ),
    findCompatibleTool(
      [paths.snakemakeExecutable],
      toolingPolicy.snakemake.minimumVersion,
      toolingPolicy.snakemake.maximumVersionExclusive,
    ),
    findCompatibleTool(
      [paths.pythonExecutable],
      toolingPolicy.python.minimumVersion,
      toolingPolicy.python.maximumVersionExclusive,
    ),
  ]);

  // Node is already available because it is currently executing this CLI.
  const node = validateDetectedTool(
    {command: 'node', version: process.version},
    toolingPolicy.node.minimumVersion,
    toolingPolicy.node.maximumVersionExclusive,
  );

  const completed = {node, pixi, conda, snakemake, python};
  const allAvailable = Object.values(completed).every(result => result.state === 'available');

  return allAvailable
    ? {...completed, state: 'ready'}
    : {...completed, state: 'setup-required'};
}
