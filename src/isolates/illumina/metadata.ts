import type {ReadSet, IsolateCatalogValidationIssue} from '../catalog.js';

export function validateIlluminaMetadata(value: unknown, path: string, issues: IsolateCatalogValidationIssue[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({path, message: 'must be a mapping'});
    return;
  }
  const metadata = value as Record<string, unknown>;
  for (const key of Object.keys(metadata)) {
    if (key !== 'chemistry' && key !== 'poly_g') {
      issues.push({path: `${path}.${key}`, message: 'unknown field'});
    }
  }
  if (!['four-colour', 'two-colour', 'one-channel', 'unknown'].includes(String(metadata.chemistry))) {
    issues.push({path: `${path}.chemistry`, message: 'must be four-colour, two-colour, one-channel, or unknown'});
  }
  if (!['auto', 'on', 'off'].includes(String(metadata.poly_g))) {
    issues.push({path: `${path}.poly_g`, message: 'must be auto, on, or off'});
  }
}

export function createIlluminaReadSet(fields: Pick<ReadSet, 'id' | 'name' | 'library_id' | 'read_pairs'>): ReadSet {
  return {...fields, platform: 'illumina', layout: 'paired-end', illumina: {chemistry: 'two-colour', poly_g: 'auto'}};
}

/** Illumina policy, not a platform-independent preprocessing profile. */
export type IlluminaPreprocessing = {
  poly_g: boolean;
  poly_g_source: 'chemistry' | 'explicit';
  poly_g_min_length: 10;
  minimum_length: 30;
  quality_filtering: false;
  paired_adapter_detection: true;
};

export function illuminaCompatibility(readSet: ReadSet): string[] {
  const reasons: string[] = [];
  if (readSet.platform !== 'illumina') {
    reasons.push('Unsupported platform: paired-end Illumina is required');
  }
  if (readSet.layout !== 'paired-end') {
    reasons.push('Unsupported layout: paired-end reads are required');
  }
  if (!readSet.library_id) {
    reasons.push('Confirm library identity');
  }
  if (readSet.read_pairs.some(pair => pair.trimmed === null)) {
    reasons.push('Review unknown previous processing');
  }
  if (readSet.illumina.poly_g === 'auto' && !['four-colour', 'two-colour'].includes(readSet.illumina.chemistry) &&
      readSet.read_pairs.some(pair => pair.trimmed !== true)) {
    reasons.push(readSet.illumina.chemistry === 'one-channel'
      ? 'One-channel chemistry has no validated Auto default: choose poly-G On or Off'
      : 'Unknown chemistry: choose poly-G On or Off');
  }
  return reasons;
}

export function resolveIlluminaPreprocessing(readSet: ReadSet): IlluminaPreprocessing {
  const reasons = illuminaCompatibility(readSet);
  if (reasons.length > 0) {
    throw new Error(reasons.join('; '));
  }
  return {
    poly_g: readSet.illumina.poly_g === 'on' ||
      (readSet.illumina.poly_g === 'auto' && readSet.illumina.chemistry === 'two-colour'),
    poly_g_source: readSet.illumina.poly_g === 'auto' ? 'chemistry' : 'explicit',
    poly_g_min_length: 10,
    minimum_length: 30,
    quality_filtering: false,
    paired_adapter_detection: true,
  };
}
