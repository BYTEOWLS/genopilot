import {basename} from 'node:path';
import {genomeSources} from '../accessions/registry.js';
import type {GenomeCacheRequest} from '../accessions/cache.js';
import type {AccessionEntry} from '../accessions/catalog.js';
import {sameReference, type FileKind, type GenomeReference} from '../accessions/provider.js';
import {isRecord, rejectUnknownFields, validateAbsolutePath, type ConfigurationValidationIssue} from './configuration-validation.js';

export type GenomeCacheMode = 'reuse' | 'refresh';
export type RemoteGenomeInput = {
  source: 'remote';
  reference: GenomeReference;
  cache_mode: GenomeCacheMode;
  copy?: GenomeCacheRequest['copy'];
};

/** Saved references are provider-validated; Python trusts application-saved configurations. */
export function validateRemoteGenomeInput(
  value: Record<string, unknown>, path: string, kinds: readonly FileKind[],
  issues: ConfigurationValidationIssue[],
): RemoteGenomeInput | undefined {
  const before = issues.length;
  rejectUnknownFields(value, ['source', 'reference', 'cache_mode', 'copy'], path, issues);
  try {
    if (isRecord(value.reference)) {
      rejectUnknownFields(value.reference, ['source', 'id', 'parameters'], `${path}.reference`, issues);
    }
    genomeSources.validateReference(value.reference);
  } catch (error) {
    issues.push({path: `${path}.reference`, message: error instanceof Error ? error.message : 'invalid genome reference'});
  }
  if (value.cache_mode !== 'reuse' && value.cache_mode !== 'refresh') {
    issues.push({path: `${path}.cache_mode`, message: "must be 'reuse' or 'refresh'"});
  }
  if (value.copy !== undefined) {
    if (!isRecord(value.copy)) {
      issues.push({path: `${path}.copy`, message: 'must be an object'});
    } else {
      rejectUnknownFields(value.copy, ['path', ...kinds.map(kind => `${kind}_sha256`)], `${path}.copy`, issues);
      if (validateAbsolutePath(value.copy.path, `${path}.copy.path`, issues)
        && isRecord(value.reference) && basename(value.copy.path) !== value.reference.id) {
        issues.push({path: `${path}.copy.path`, message: 'must name the referenced genome directory'});
      }
      for (const kind of kinds) {
        if (typeof value.copy[`${kind}_sha256`] !== 'string' || !/^[a-f0-9]{64}$/.test(value.copy[`${kind}_sha256`] as string)) {
          issues.push({path: `${path}.copy.${kind}_sha256`, message: 'must be a lowercase SHA-256 checksum'});
        }
      }
    }
    if (value.cache_mode !== 'reuse') {
      issues.push({path: `${path}.copy`, message: 'is only allowed with reuse mode'});
    }
  }
  return issues.length === before ? value as RemoteGenomeInput : undefined;
}

/** Snapshot only a copy containing every required artifact; resolution rechecks its bytes. */
export function snapshotGenomeCopy(input: RemoteGenomeInput, kinds: readonly FileKind[], entries: readonly AccessionEntry[]): void {
  if (input.cache_mode !== 'reuse') {
    delete input.copy;
    return;
  }
  if (input.copy) {
    return;
  }
  const entry = entries.find(entry => sameReference(entry, input.reference)
    && JSON.stringify(entry.parameters) === JSON.stringify(input.reference.parameters));
  const copy = entry?.cached_copies.find(copy => kinds.every(kind => copy[`${kind}_sha256`]));
  if (copy) {
    input.copy = {path: copy.path};
    for (const kind of kinds) {
      input.copy[`${kind}_sha256`] = copy[`${kind}_sha256`];
    }
  }
}
