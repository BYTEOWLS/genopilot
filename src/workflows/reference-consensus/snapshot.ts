import {parse} from 'yaml';
import {validateIsolate, type Isolate} from '../../isolates/catalog.js';
import {
  isRecord,
  rejectUnknownFields,
  validateTimestamp,
  type ConfigurationValidationIssue,
} from '../configuration-validation.js';
import {ReferenceConsensusConfigurationError} from './configuration.js';

export const ISOLATE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * The selected isolates exactly as the catalog described them when the run was created. A run
 * reads only this copy, so later catalog edits cannot change what an old run claims to have used.
 */
export type IsolateSnapshot = {
  schema_version: typeof ISOLATE_SNAPSHOT_SCHEMA_VERSION;
  captured_at: string;
  isolates: Isolate[];
};

/** Validates a snapshot and that it holds exactly the configuration's selection, in order. */
export function validateIsolateSnapshot(
  value: unknown,
  selectedIsolates: readonly string[],
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
    value.isolates.forEach((isolate, index) => validateIsolate(isolate, `$.isolates[${index}]`, issues));
    const ids = value.isolates.map(isolate => (isRecord(isolate) ? isolate.id : undefined));
    if (ids.length !== selectedIsolates.length || ids.some((id, index) => id !== selectedIsolates[index])) {
      issues.push({
        path: '$.isolates',
        message: `must hold exactly the selected isolates in order: ${selectedIsolates.join(', ')}`,
      });
    }
  }
  if (issues.length > 0) {
    throw new ReferenceConsensusConfigurationError(issues);
  }
  return value as IsolateSnapshot;
}

export function parseIsolateSnapshot(source: string, selectedIsolates: readonly string[]): IsolateSnapshot {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReferenceConsensusConfigurationError([
      {path: '$', message: `is not valid YAML: ${detail}`},
    ]);
  }
  return validateIsolateSnapshot(value, selectedIsolates);
}
