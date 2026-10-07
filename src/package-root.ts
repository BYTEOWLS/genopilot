import {fileURLToPath} from 'node:url';

/**
 * The installed package's root directory. This module sits directly under `src/` and is
 * compiled into `dist/cli.js`, so one directory up is the root both when the sources run
 * through `tsx` and when the bundle runs from an installation.
 */
export const packageRoot = new URL('../', import.meta.url);

/** The URL of a packaged file or directory, given relative to the package root. */
export function packagedUrl(relativePath: string): URL {
  return new URL(relativePath, packageRoot);
}

/** The filesystem path of a packaged file or directory, given relative to the package root. */
export function packagedPath(relativePath: string): string {
  return fileURLToPath(packagedUrl(relativePath));
}
