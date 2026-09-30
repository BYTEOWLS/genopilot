export type SupportedPlatform = 'darwin' | 'linux';
export type SupportedArchitecture = 'arm64' | 'x64';

export type RuntimeDownload = {
  platform: SupportedPlatform;
  architecture: SupportedArchitecture;
  url: string;
  sha256: string;
};

const pixiVersion = '0.81.0';
const pixiReleaseTag = `v${pixiVersion}`;

/**
 * Compatibility and installation policy shipped with this CLI release.
 *
 * Pixi installs Snakemake and Conda together in one global environment. Conda
 * must remain alongside Snakemake because Snakemake currently uses the `conda`
 * command to provision environments declared by workflow rules. Python is pinned
 * too: rules without their own environment run their scripts on Snakemake's
 * interpreter.
 *
 * Paths are relative to the user data directory so the package remains
 * independent of the directory from which the CLI is invoked. Every platform
 * uses the same hidden directory under the user's home: one location to
 * document and back up, and one without whitespace, which matters because
 * Snakemake (checked with 9.26.1) does not quote Conda's activation-script path when
 * constructing rule commands.
 */
export const toolingPolicy = {
  node: {
    minimumVersion: '24.0.0',
    maximumVersionExclusive: '26.0.0',
    installationVersion: '24 LTS',
    versionsTestedWith: ['24.19.0'],
  },
  pixi: {
    command: 'pixi',
    minimumVersion: pixiVersion,
    maximumVersionExclusive: '0.81.1',
    versionsTestedWith: [],
    managedVersion: pixiVersion,
    releaseTag: pixiReleaseTag,
    relativeExecutablePath: `runtimes/pixi/${pixiVersion}/bin/pixi`,
    maximumDownloadBytes: 100 * 1024 * 1024,
    allowedDownloadHosts: ['github.com', 'release-assets.githubusercontent.com'] as const,
    downloads: [
      {
        platform: 'linux',
        architecture: 'x64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-x86_64-unknown-linux-musl.tar.gz`,
        sha256: '7aa3ec39aecceff9062fa2ed4d42cbaa0bdc25ddea727d048e061cf188d434f6',
      },
      {
        platform: 'linux',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-unknown-linux-musl.tar.gz`,
        sha256: '9f8d2113fe9dc01788a65f5c2acec34fa56b1193461a5c3e9a775d6d2d621bcb',
      },
      {
        platform: 'darwin',
        architecture: 'x64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-x86_64-apple-darwin.tar.gz`,
        sha256: '9859588ba57f390b5c77d56b2654fab37bc00e10952da25e3efd6e3434557e5a',
      },
      {
        platform: 'darwin',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-apple-darwin.tar.gz`,
        sha256: 'f4e32ea91970d4e11739488817979a5f2c6ebbb9cedb0d6dea74b2b790b272dc',
      },
    ] satisfies RuntimeDownload[],
  },
  conda: {
    command: 'conda',
    minimumVersion: '26.7.3',
    maximumVersionExclusive: '26.7.4',
    versionsTestedWith: [],
    managedVersion: '26.7.3',
    package: 'conda=26.7.3',
  },
  snakemake: {
    command: 'snakemake',
    minimumVersion: '9.27.0',
    maximumVersionExclusive: '9.27.1',
    versionsTestedWith: [],
    managedVersion: '9.27.0',
    package: 'snakemake=9.27.0',
  },
  python: {
    command: 'python',
    minimumVersion: '3.14.7',
    maximumVersionExclusive: '3.14.8',
    versionsTestedWith: [],
    managedVersion: '3.14.7',
    package: 'python=3.14.7',
  },
  managedGlobalEnvironment: {
    name: 'byteowls-genopilot',
    relativeHomePath: 'pixi',
    channels: ['conda-forge', 'bioconda'] as const,
    packages: ['snakemake=9.27.0', 'conda=26.7.3', 'python=3.14.7'] as const,
    relativeSnakemakeExecutablePath: 'pixi/bin/snakemake',
    relativeCondaExecutablePath: 'pixi/bin/conda',
    // The environment's own interpreter, which Snakemake runs on. Pixi exposes `python` only
    // when it first creates the environment, so an upgraded installation has no pixi/bin/python.
    relativePythonExecutablePath: 'pixi/envs/byteowls-genopilot/bin/python',
  },
  managedDataDirectory: {
    relativeToHome: '.byteowlsGenopilot/tooling',
  },
} as const;
