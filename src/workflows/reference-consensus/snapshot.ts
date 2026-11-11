import {parse} from 'yaml';
import {validateIsolate, type Isolate, type ReadSet} from '../../isolates/catalog.js';
import {resolveIlluminaPreprocessing, type IlluminaPreprocessing} from '../../isolates/illumina/metadata.js';
import {
  isRecord,
  rejectUnknownFields,
  validateTimestamp,
  type ConfigurationValidationIssue,
} from '../configuration-validation.js';
import {ReferenceConsensusConfigurationError} from './configuration.js';

export const ISOLATE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type SnapshotReadSet = ReadSet & {effective_preprocessing: IlluminaPreprocessing};
export type SnapshotIsolate = Omit<Isolate, 'read_sets'> & {read_sets: SnapshotReadSet[]};

/**
 * Selected read sets and resolved settings at run creation. A run reads only this copy,
 * so later catalog edits cannot change its inputs or claimed effective settings.
 */
export type IsolateSnapshot = {
  schema_version: typeof ISOLATE_SNAPSHOT_SCHEMA_VERSION;
  captured_at: string;
  isolates: SnapshotIsolate[];
};

/** Validates a snapshot and that it holds exactly the configuration's selection, in order. */
export function validateIsolateSnapshot(
  value: unknown,
  selectedIsolates: readonly string[],
  selectedReadSets?: readonly string[],
): IsolateSnapshot {
  const issues: ConfigurationValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new ReferenceConsensusConfigurationError([{path: '$', message: 'must be an object'}]);
  }
  rejectUnknownFields(value, ['schema_version', 'captured_at', 'isolates'], '$', issues);
  if (value.schema_version !== ISOLATE_SNAPSHOT_SCHEMA_VERSION) {
    issues.push({
      path: '$.schema_version',
      message: `must equal supported version ${ISOLATE_SNAPSHOT_SCHEMA_VERSION}`,
    });
  }
  validateTimestamp(value.captured_at, '$.captured_at', issues);
  if (!Array.isArray(value.isolates)) {
    issues.push({path: '$.isolates', message: 'must be a list'});
  } else {
    value.isolates.forEach((isolate, index) => {
      const path = `$.isolates[${index}]`;
      if (!isRecord(isolate) || !Array.isArray(isolate.read_sets)) {
        validateIsolate(isolate, path, issues);
        return;
      }
      const plain = {...isolate, read_sets: isolate.read_sets.map(readSet => {
        if (!isRecord(readSet)) {
          return readSet;
        }
        const {effective_preprocessing: _effective, ...metadata} = readSet;
        return metadata;
      })};
      const before = issues.length;
      validateIsolate(plain, path, issues);
      if (issues.length === before) {
        isolate.read_sets.forEach((readSet, setIndex) => {
          try {
            const expected = resolveIlluminaPreprocessing(plain.read_sets[setIndex] as ReadSet);
            if (!isRecord(readSet) || !isRecord(readSet.effective_preprocessing) ||
                Object.keys(readSet.effective_preprocessing).length !== Object.keys(expected).length ||
                Object.entries(expected).some(([key, setting]) => (readSet.effective_preprocessing as Record<string, unknown>)[key] !== setting)) {
              issues.push({path: `${path}.read_sets[${setIndex}].effective_preprocessing`, message: 'must match resolved Illumina settings'});
            }
          } catch (error) {
            issues.push({path: `${path}.read_sets[${setIndex}]`, message: error instanceof Error ? error.message : String(error)});
          }
        });
      }
    });
    const ids = value.isolates.map(isolate => (isRecord(isolate) ? isolate.id : undefined));
    if (ids.length !== selectedIsolates.length || ids.some((id, index) => id !== selectedIsolates[index])) {
      issues.push({
        path: '$.isolates',
        message: `must hold exactly the selected isolates in order: ${selectedIsolates.join(', ')}`,
      });
    }
  }
  if (issues.length === 0) {
    const snapshot = value as IsolateSnapshot;
    const keys = snapshot.isolates.flatMap(isolate => isolate.read_sets.map(set => `${isolate.id}/${set.id}`));
    if (new Set(keys).size !== keys.length || (selectedReadSets &&
        (keys.length !== selectedReadSets.length || keys.some((key, index) => key !== selectedReadSets[index])))) {
      issues.push({path: '$.isolates', message: 'must hold exactly the selected read sets in order, without duplicates'});
    }
    const files = snapshot.isolates.flatMap(isolate => isolate.read_sets.flatMap(set => set.read_pairs.flatMap(pair => [pair.r1, pair.r2])));
    if (new Set(files).size !== files.length) {
      issues.push({path: '$.isolates', message: 'a read file is selected more than once'});
    }
  }
  if (issues.length > 0) {
    throw new ReferenceConsensusConfigurationError(issues);
  }
  return value as IsolateSnapshot;
}

export function parseIsolateSnapshot(source: string, selectedIsolates: readonly string[], selectedReadSets?: readonly string[]): IsolateSnapshot {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReferenceConsensusConfigurationError([
      {path: '$', message: `is not valid YAML: ${detail}`},
    ]);
  }
  return validateIsolateSnapshot(value, selectedIsolates, selectedReadSets);
}
