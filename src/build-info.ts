import {spawnSync} from 'node:child_process';
import {packagedPath} from './package-root.js';

/** The Git commit the application was built from; the version alone is shared by many commits. */
export type BuildInfo = {
  commit: string;
  /** The commit's committer date, as ISO 8601. */
  committedAt: string;
  /** Whether the working tree differed from the commit. */
  modified: boolean;
  /**
   * Whether this is a release build: the one `pnpm publish` makes, which refuses uncommitted
   * changes. Only runs of a release build are citable, because only releases get a DOI.
   */
  released: boolean;
};

// Defined by the build (scripts/build.mjs); absent when the sources run through tsx.
declare const __GENOPILOT_BUILD__: BuildInfo | null | undefined;

export type GitRunner = (arguments_: readonly string[]) => string | undefined;

const runGit: GitRunner = arguments_ => {
  const result = spawnSync('git', ['-C', packagedPath('.'), ...arguments_], {encoding: 'utf8'});
  return result.status === 0 ? result.stdout : undefined;
};

/** Reads the commit of a source checkout, or nothing outside one or without Git. */
export function gitBuildInfo(git: GitRunner = runGit): BuildInfo | undefined {
  const [commit, committedAt] = git(['log', '-1', '--format=%H%n%cI'])?.trim().split('\n') ?? [];
  const status = git(['status', '--porcelain']);
  if (!commit || !committedAt || status === undefined) {
    return undefined;
  }
  // Running the sources is never a release, even from a tagged commit.
  return {commit, committedAt, modified: status.trim().length > 0, released: false};
}

/** The build's commit, embedded by the build or, when running the sources, read from Git. */
export function readBuildInfo(): BuildInfo | undefined {
  return typeof __GENOPILOT_BUILD__ === 'undefined' ? gitBuildInfo() : __GENOPILOT_BUILD__ ?? undefined;
}
