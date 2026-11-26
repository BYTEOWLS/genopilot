import {chmod, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {GenomeProvider} from '../accessions/provider.js';
import {resolveToolingPaths} from './paths.js';

export type ProviderSettings = {
  read(provider: GenomeProvider): Promise<Record<string, string>>;
  save(provider: GenomeProvider, field: string, value: string): Promise<void>;
  clear(provider: GenomeProvider, field: string): Promise<void>;
};

/** Secrets are addressed only by registered provider/field IDs, never genome parameters. */
export function providerSettings(directory = resolveToolingPaths().secretsDirectory): ProviderSettings {
  const fieldPath = (provider: GenomeProvider, field: string): string => {
    if (!/^[a-z][a-z0-9-]*$/.test(provider.id) || !provider.fields.some(candidate => candidate.id === field)) {
      throw new Error('Unknown provider setting.');
    }
    return join(directory, provider.id, field);
  };
  return {
    async read(provider) {
      const values: Record<string, string> = {};
      for (const field of provider.fields) {
        try {
          const value = (await readFile(fieldPath(provider, field.id), 'utf8')).trim();
          if (value) {
            values[field.id] = value;
          }
        } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
            throw new Error('Unable to read provider settings.');
          }
        }
      }
      return values;
    },
    async save(provider, field, value) {
      const path = fieldPath(provider, field);
      const clean = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
      if (!clean) {
        throw new Error('The secret must not be empty.');
      }
      const folder = join(directory, provider.id);
      await mkdir(folder, {recursive: true, mode: 0o700});
      await chmod(folder, 0o700);
      const staging = join(folder, `.${randomUUID()}`);
      try {
        await writeFile(staging, `${clean}\n`, {flag: 'wx', mode: 0o600});
        await rename(staging, path);
      } finally {
        await rm(staging, {force: true});
      }
    },
    async clear(provider, field) {
      await rm(fieldPath(provider, field), {force: true});
    },
  };
}

/** Provider errors may describe failures, but never expose authentication values. */
export function providerError(error: unknown, secrets: Readonly<Record<string, string>>): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(secrets)) {
    if (value) {
      message = message.split(value).join('[redacted]').split(encodeURIComponent(value)).join('[redacted]');
    }
  }
  return message;
}
