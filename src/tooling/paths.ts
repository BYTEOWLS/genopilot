import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {
  toolingPolicy,
  type SupportedArchitecture,
  type SupportedPlatform,
} from './policy.js';

export type ToolingPaths = {
  platform: SupportedPlatform;
  architecture: SupportedArchitecture;
  dataDirectory: string;
  pixiExecutable: string;
  pixiHome: string;
  managedBinDirectory: string;
  condaExecutable: string;
  snakemakeExecutable: string;
  logsDirectory: string;
  temporaryDirectory: string;
  condaEnvironmentsDirectory: string;
  installationLockPath: string;
  secretsDirectory: string;
  ncbiApiKeyPath: string;
};

function supportedPlatform(value: NodeJS.Platform): SupportedPlatform {
  if (value === 'darwin' || value === 'linux') {
    return value;
  }
  throw new Error(`Unsupported platform: ${value}. Use Linux or macOS.`);
}

function supportedArchitecture(value: string): SupportedArchitecture {
  if (value === 'arm64' || value === 'x64') {
    return value;
  }
  throw new Error(`Unsupported architecture: ${value}. Use x64 or arm64.`);
}

/** Resolves every managed-tool path without depending on the working directory. */
export function resolveToolingPaths({
  platform = process.platform,
  architecture = process.arch,
  environment = process.env,
  homeDirectory = homedir(),
}: {
  platform?: NodeJS.Platform;
  architecture?: string;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): ToolingPaths {
  const resolvedPlatform = supportedPlatform(platform);
  const resolvedArchitecture = supportedArchitecture(architecture);
  let dataDirectory: string;
  if (resolvedPlatform === 'linux') {
    const directoryPolicy = toolingPolicy.managedDataDirectories.linux;
    const configuredBase = environment[directoryPolicy.environmentVariable];
    dataDirectory = configuredBase
      ? join(configuredBase, directoryPolicy.directoryNameWhenEnvironmentSet)
      : join(homeDirectory, directoryPolicy.fallbackRelativeToHome);
  } else {
    const directoryPolicy = toolingPolicy.managedDataDirectories.darwin;
    dataDirectory = join(homeDirectory, directoryPolicy.fallbackRelativeToHome);
  }

  const pixiHome = join(dataDirectory, toolingPolicy.managedGlobalEnvironment.relativeHomePath);

  return {
    platform: resolvedPlatform,
    architecture: resolvedArchitecture,
    dataDirectory: resolve(dataDirectory),
    pixiExecutable: join(dataDirectory, toolingPolicy.pixi.relativeExecutablePath),
    pixiHome,
    managedBinDirectory: join(pixiHome, 'bin'),
    condaExecutable: join(
      dataDirectory,
      toolingPolicy.managedGlobalEnvironment.relativeCondaExecutablePath,
    ),
    snakemakeExecutable: join(
      dataDirectory,
      toolingPolicy.managedGlobalEnvironment.relativeSnakemakeExecutablePath,
    ),
    logsDirectory: join(dataDirectory, 'logs'),
    temporaryDirectory: join(dataDirectory, 'temporary'),
    // Shared by every run: Snakemake names each rule environment by a hash of its pinned
    // environment file, so one stable location is provisioned once and then reused, while a
    // changed pin still resolves to a new directory. Keeping it beside the managed Pixi and
    // Conda tooling leaves a run directory holding only its own state rather than a private
    // 600 MB copy of the same environments.
    condaEnvironmentsDirectory: join(dataDirectory, 'conda-envs'),
    installationLockPath: join(dataDirectory, 'tooling-setup.lock'),
    secretsDirectory: join(dataDirectory, 'secrets'),
    ncbiApiKeyPath: join(dataDirectory, 'secrets', 'ncbi-api-key'),
  };
}

/** Selects the immutable Pixi archive for the current platform and architecture. */
export function selectPixiDownload(paths: ToolingPaths) {
  const download = toolingPolicy.pixi.downloads.find(
    candidate =>
      candidate.platform === paths.platform && candidate.architecture === paths.architecture,
  );

  if (!download) {
    throw new Error(`No Pixi download configured for ${paths.platform}/${paths.architecture}.`);
  }

  return download;
}
