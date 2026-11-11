export type SupportedPlatform = 'darwin' | 'linux';
export type SupportedArchitecture = 'arm64' | 'x64';

export type RuntimeDownload = {
  platform: SupportedPlatform;
  architecture: SupportedArchitecture;
  url: string;
  sha256: string;
};

const pixiVersion = '0.84.2';
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
    minimumVersion: '24.15.0',
    maximumVersionExclusive: '27.0.0',
    installationVersion: '24 LTS',
  },
  pixi: {
    command: 'pixi',
    minimumVersion: pixiVersion,
    maximumVersionExclusive: '0.84.3',
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
        sha256: '6d2a576bde0a7b26533a068fec0aea6e4ee21c36668efc1dc73fce90110906ae',
      },
      {
        platform: 'linux',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-unknown-linux-musl.tar.gz`,
        sha256: '0957b6352d077bb3ffcce913f90b1e6cfbc6b98888a45d59ee2910e8c4811110',
      },
      {
        platform: 'darwin',
        architecture: 'x64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-x86_64-apple-darwin.tar.gz`,
        sha256: 'a633a4f8276955b73248397c17ce77380eb7133dc96c54bc271239b7dc9b8837',
      },
      {
        platform: 'darwin',
        architecture: 'arm64',
        url: `https://github.com/prefix-dev/pixi/releases/download/${pixiReleaseTag}/pixi-aarch64-apple-darwin.tar.gz`,
        sha256: '039d4b48c7e17bc62a36faa2af1b13d0d187f5dd6e8fea17e0587302438df6e6',
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
    minimumVersion: '3.13.18',
    maximumVersionExclusive: '3.13.19',
    managedVersion: '3.13.18',
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
