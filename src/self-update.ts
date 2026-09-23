import {spawn} from 'node:child_process';

export type UpdateCommandRunner = (
  command: string,
  arguments_: readonly string[],
) => Promise<number>;

export type LatestVersionReader = (
  packageName: string,
  signal?: AbortSignal,
) => Promise<string>;

export type UpdateOutput = {
  info(message: string): void;
  error(message: string): void;
};

export type UpdateAvailability =
  | {state: 'current'}
  | {state: 'available'; latestVersion: string};

type SelfUpdateDependencies = {
  readLatestVersion?: LatestVersionReader;
  runCommand?: UpdateCommandRunner;
  output?: UpdateOutput;
  displayName?: string;
  commandName?: string;
};

const registryCheckTimeoutMilliseconds = 30_000;
const maximumRegistryOutputCharacters = 64 * 1024;

/** Runs a command directly so package metadata cannot be interpreted by a shell. */
export const runUpdateCommand: UpdateCommandRunner = (command, arguments_) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: 'inherit',
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });

/** Reads npm's current `latest` dist-tag without invoking a shell. */
export const readLatestNpmVersion: LatestVersionReader = (packageName, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn('npm', ['view', packageName, 'dist-tags.latest', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error?: Error, version?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(version ?? '');
      }
    };

    const collect = (target: 'stdout' | 'stderr', chunk: unknown): void => {
      if (target === 'stdout') {
        stdout += String(chunk);
      } else {
        stderr += String(chunk);
      }
      if (stdout.length + stderr.length > maximumRegistryOutputCharacters) {
        child.kill();
        finish(new Error('registry response exceeded the safety limit'));
      }
    };

    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code !== 0) {
        finish(new Error(stderr.trim() || `npm registry check exited with code ${String(code)}`));
        return;
      }

      try {
        const value: unknown = JSON.parse(stdout);
        if (typeof value !== 'string' || !value.trim()) {
          finish(new Error('npm registry returned an invalid latest version'));
          return;
        }
        finish(undefined, value.trim());
      } catch {
        finish(new Error('npm registry returned an invalid response'));
      }
    });

    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('npm registry check timed out'));
    }, registryCheckTimeoutMilliseconds);
  });

type ParsedVersion = {
  core: readonly [number, number, number];
  prerelease: readonly string[];
};

function parseVersion(version: string): ParsedVersion | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left.localeCompare(right);
}

/** Applies SemVer ordering, including prerelease identifiers. */
export function compareVersions(left: string, right: string): number | undefined {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    return undefined;
  }

  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const difference = parsedLeft.core[index] - parsedRight.core[index];
    if (difference !== 0) {
      return difference;
    }
  }

  if (parsedLeft.prerelease.length === 0 || parsedRight.prerelease.length === 0) {
    if (parsedLeft.prerelease.length === parsedRight.prerelease.length) {
      return 0;
    }
    return parsedLeft.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    const difference = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** Checks npm's `latest` tag without treating an older registry version as an update. */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
  readLatestVersion: LatestVersionReader = readLatestNpmVersion,
  signal?: AbortSignal,
): Promise<UpdateAvailability> {
  const latestVersion = await readLatestVersion(packageName, signal);
  const comparison = compareVersions(latestVersion, currentVersion);
  if (comparison === undefined) {
    throw new Error(`the version response ${JSON.stringify(latestVersion)} is invalid`);
  }
  return comparison > 0 ? {state: 'available', latestVersion} : {state: 'current'};
}

/** Checks for and installs an exact newer release from npm's `latest` tag. */
export async function selfUpdate(
  packageName: string,
  currentVersion: string,
  dependencies: SelfUpdateDependencies = {},
): Promise<number> {
  const readLatestVersion = dependencies.readLatestVersion ?? readLatestNpmVersion;
  const runner = dependencies.runCommand ?? runUpdateCommand;
  const output = dependencies.output ?? console;
  const displayName = dependencies.displayName ?? packageName;
  const commandName = dependencies.commandName ?? 'genopilot';

  output.info(`Checking for updates (current: v${currentVersion})...`);

  try {
    const availability = await checkForUpdate(packageName, currentVersion, readLatestVersion);
    if (availability.state === 'current') {
      output.info(`${displayName} is already up to date (v${currentVersion}).`);
      return 0;
    }

    const {latestVersion} = availability;
    output.info(`Updating v${currentVersion} → v${latestVersion}...`);
    const exitCode = await runner('npm', [
      'install',
      '--global',
      '--ignore-scripts',
      `${packageName}@${latestVersion}`,
    ]);
    if (exitCode !== 0) {
      output.error(`Update failed: npm exited with code ${exitCode}.`);
      return exitCode;
    }

    output.info(`Updated successfully to v${latestVersion}. Run \`${commandName}\` to start it.`);
    return 0;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    output.error(`Update failed: ${detail}`);
    return 1;
  }
}
