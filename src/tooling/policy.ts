export type SupportedPlatform = 'darwin' | 'linux';
export type SupportedArchitecture = 'arm64' | 'x64';

export type RuntimeDownload = {
  platform: SupportedPlatform;
  architecture: SupportedArchitecture;
  url: string;
  sha256: string;
};

const pixiVersion = '0.82.1';
const pixiReleaseTag = `v${pixiVersion}`;

/**
 * Compatibility and installation policy shipped with this CLI release.
 *
 * Pixi installs Snakemake and Conda together from the packaged, locked workspace
 * in `runtime/`, whose `pixi.toml` pins the versions repeated here for
 * verification. Conda must remain alongside Snakemake because Snakemake
 * currently uses the `conda` command to provision environments declared by
 * workflow rules. Python is pinned too: rules without their own environment run
 * their scripts on Snakemake's interpreter.
 *
 * Paths are relative to the user data directory so the package remains
 * independent of the directory from which the CLI is invoked. Every platform
 * uses the same hidden directory under the user's home: one location to
 * document and back up, and one without whitespace, which matters because
 * Snakemake does not quote Conda's activation-script path when
 * constructing rule commands.
 */
export const toolingPolicy = {
  node: {
    minimumVersion: '24.0.0',
    maximumVersionExclusive: '26.0.0',
    installationVersion: '24 LTS',
  },
  pixi: {
    command: 'pixi',
    minimumVersion: pixiVersion,
    maximumVersionExclusive: '0.82.2',
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
        sha256: '7ac72af79c50653bfcfddb2473b6e9eff2654affe0057d19fe21b0d8556a7fe2',
      },
      {
        platform: 'linux',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-unknown-linux-musl.tar.gz`,
        sha256: '6f4c4a101b84b15f33440f39fe5889afb1b77a4e88f02962248240cdcab56966',
      },
      {
        platform: 'darwin',
        architecture: 'x64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-x86_64-apple-darwin.tar.gz`,
        sha256: '249e92ad4254642ecc3dd2d498b082cfd417c4de219dc9b093750671d882f0e2',
      },
      {
        platform: 'darwin',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-apple-darwin.tar.gz`,
        sha256: 'cf02c669b8c4a3d7332b6aa30931d37587c299d906b30d9827b9d40cec9b0c47',
      },
    ] satisfies RuntimeDownload[],
  },
  conda: {
    command: 'conda',
    minimumVersion: '26.7.3',
    maximumVersionExclusive: '26.7.4',
    managedVersion: '26.7.3',
  },
  snakemake: {
    command: 'snakemake',
    minimumVersion: '9.27.1',
    maximumVersionExclusive: '9.27.2',
    managedVersion: '9.27.1',
  },
  // The rule environments pin the same Python, so every workflow script runs on one version.
  // It stays on 3.13 until bioconda's parasail-python, which LiftOn needs, is built for 3.14.
  python: {
    command: 'python',
    minimumVersion: '3.13.16',
    maximumVersionExclusive: '3.13.17',
    managedVersion: '3.13.16',
  },
  managedRuntime: {
    // Pixi's own home, kept inside the data directory so the user's Pixi configuration and
    // global environments stay untouched.
    relativePixiHomePath: 'pixi',
    // The locked workspace is copied into a directory named after the lock's checksum, so a
    // release with a changed lock installs anew instead of reusing an older environment.
    relativeDirectory: 'runtime',
    relativeBinPath: '.pixi/envs/default/bin',
  },
  managedDataDirectory: {
    relativeToHome: '.byteowlsGenopilot/tooling',
  },
} as const;
