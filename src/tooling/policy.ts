export type SupportedPlatform = 'darwin' | 'linux';
export type SupportedArchitecture = 'arm64' | 'x64';

export type RuntimeDownload = {
  platform: SupportedPlatform;
  architecture: SupportedArchitecture;
  url: string;
  sha256: string;
};

const pixiVersion = '0.79.0';
const pixiReleaseTag = `v${pixiVersion}`;

/**
 * Compatibility and installation policy shipped with this CLI release.
 *
 * Pixi installs Snakemake and Conda together in one global environment. Conda
 * must remain alongside Snakemake because Snakemake currently uses the `conda`
 * command to provision environments declared by workflow rules.
 *
 * Paths are relative to the user data directory so the package remains
 * independent of the directory from which the CLI is invoked. The resolver
 * uses XDG_DATA_HOME (or ~/.local/share) on Linux. On macOS it deliberately
 * uses a whitespace-free hidden directory under the user's home because
 * Snakemake 9.26.1 does not quote Conda's activation-script path when
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
    maximumVersionExclusive: '0.79.1',
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
        sha256: 'b9b6dd2bdf4e0043c2c0cd6d15334a26c6851121bf5ae16c39b69add598bafdc',
      },
      {
        platform: 'linux',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-unknown-linux-musl.tar.gz`,
        sha256: 'a402a2a3e2c785b7855c482db46d65a915c0ac04fdf041410f218980a5247290',
      },
      {
        platform: 'darwin',
        architecture: 'x64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-x86_64-apple-darwin.tar.gz`,
        sha256: '972679722ee4ce97538c731ab67d516c3c155f2184ec16f777f5bd79623bb531',
      },
      {
        platform: 'darwin',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-apple-darwin.tar.gz`,
        sha256: '652d1d8380fa40feaa75b4ccee3a1f0b32e20a6fa2fdd84bb8e3c52962b8dc34',
      },
    ] satisfies RuntimeDownload[],
  },
  conda: {
    command: 'conda',
    minimumVersion: '25.11.1',
    maximumVersionExclusive: '25.11.2',
    versionsTestedWith: [],
    managedVersion: '25.11.1',
    package: 'conda=25.11.1',
  },
  snakemake: {
    command: 'snakemake',
    minimumVersion: '9.26.1',
    maximumVersionExclusive: '9.26.2',
    versionsTestedWith: [],
    managedVersion: '9.26.1',
    package: 'snakemake=9.26.1',
  },
  managedGlobalEnvironment: {
    name: 'byteowls-genopilot',
    relativeHomePath: 'pixi',
    channels: ['conda-forge', 'bioconda'] as const,
    packages: ['snakemake=9.26.1', 'conda=25.11.1'] as const,
    relativeSnakemakeExecutablePath: 'pixi/bin/snakemake',
    relativeCondaExecutablePath: 'pixi/bin/conda',
  },
  managedDataDirectories: {
    linux: {
      environmentVariable: 'XDG_DATA_HOME',
      fallbackRelativeToHome: '.local/share/byteowlsGenopilot/tooling',
      directoryNameWhenEnvironmentSet: 'byteowlsGenopilot/tooling',
    },
    darwin: {
      fallbackRelativeToHome: '.byteowlsGenopilot/tooling',
    },
  },
} as const;
