import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse} from 'yaml';
import {isRecord} from './configuration-validation.js';

export type RecordedArtifact = {sha256: string; origin: string};

/** A run's `artifacts.yaml`, keyed by run-relative path; only regular files with a SHA-256. */
export async function recordedArtifacts(runDirectory: string, signal?: AbortSignal): Promise<Map<string, RecordedArtifact>> {
  const path = join(runDirectory, 'artifacts.yaml');
  let source: string;
  try {
    source = await readFile(path, {encoding: 'utf8', signal});
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(`The run has no readable artifact index, so its files cannot be verified: ${path}`, {cause: error});
  }
  const index: unknown = parse(source);
  if (!isRecord(index) || index.schema_version !== 1 || !Array.isArray(index.artifacts)) {
    throw new Error(`Unsupported artifact index: ${path}`);
  }
  const artifacts = new Map<string, RecordedArtifact>();
  for (const artifact of index.artifacts) {
    if (isRecord(artifact) && typeof artifact.path === 'string' && typeof artifact.origin === 'string' && isRecord(artifact.checksum) &&
        artifact.checksum.algorithm === 'sha256' && typeof artifact.checksum.value === 'string' && /^[a-f0-9]{64}$/.test(artifact.checksum.value)) {
      artifacts.set(artifact.path, {sha256: artifact.checksum.value, origin: artifact.origin});
    }
  }
  return artifacts;
}
