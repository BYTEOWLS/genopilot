import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
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
  pythonExecutable: string;
  logsDirectory: string;
  temporaryDirectory: string;
  condaEnvironmentsDirectory: string;
  installationLockPath: string;
  secretsDirectory: string;
  ncbiApiKeyPath: string;
  isolateCatalogDirectory: string;
  isolateCatalogPath: string;
  accessionCatalogDirectory: string;
  accessionCatalogPath: string;
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
  homeDirectory = homedir(),
}: {
  platform?: NodeJS.Platform;
  architecture?: string;
  homeDirectory?: string;
} = {}): ToolingPaths {
  const resolvedPlatform = supportedPlatform(platform);
  const resolvedArchitecture = supportedArchitecture(architecture);
  const dataDirectory = join(homeDirectory, toolingPolicy.managedDataDirectory.relativeToHome);

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
    pythonExecutable: join(
      dataDirectory,
      toolingPolicy.managedGlobalEnvironment.relativePythonExecutablePath,
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
    // Research metadata sits beside, not inside, the tooling directory, so resetting or
    // deleting managed tooling never removes the researcher's isolate or accession catalog.
    isolateCatalogDirectory: join(dirname(resolve(dataDirectory)), 'isolates'),
    isolateCatalogPath: join(dirname(resolve(dataDirectory)), 'isolates', 'isolates.yaml'),
    accessionCatalogDirectory: join(dirname(resolve(dataDirectory)), 'accessions'),
    accessionCatalogPath: join(dirname(resolve(dataDirectory)), 'accessions', 'accessions.yaml'),
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
