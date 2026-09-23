import {chmod, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Reads the stored NCBI API key, or undefined when none is configured. */
export async function readNcbiApiKey(path: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function isNcbiApiKeyConfigured(path: string): Promise<boolean> {
  return (await readNcbiApiKey(path)) !== undefined;
}

/** Stores the NCBI API key in a private, owner-only file, replacing any existing key. */
export async function writeNcbiApiKey(path: string, key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new Error('The NCBI API key must not be empty.');
  }
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  await writeFile(path, `${trimmed}\n`, {encoding: 'utf8', mode: 0o600});
  // writeFile's mode only applies when the file is created; re-assert it on every save so an
  // overwrite of a pre-existing, more permissive file is not silently trusted.
  await chmod(path, 0o600);
}

/** Removes the stored NCBI API key, if any. */
export async function clearNcbiApiKey(path: string): Promise<void> {
  await rm(path, {force: true});
}
