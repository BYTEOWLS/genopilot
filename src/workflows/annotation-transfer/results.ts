import {stat} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {
  ANNOTATION_TRANSFER_WORKFLOW_ID,
  ANNOTATION_TRANSFER_WORKFLOW_VERSION,
} from './configuration.js';

export const ANNOTATION_TRANSFER_SUMMARY_SCHEMA_VERSION = 1 as const;
export const ANNOTATION_TRANSFER_METRICS_SCHEMA_VERSION = 1 as const;

export type AnnotationTransferStatus =
  | 'completed'
  | 'completed-with-warnings'
  | 'validation-failed';

export type ResultPath = {
  path: string;
  absolutePath: string;
  available: boolean;
};

type IdentitySummary = {
  unit: 'transcript_model';
  count: number;
  minimum: number | null;
  mean: number | null;
  maximum: number | null;
  unavailableReason?: string;
};

export type AnnotationTransferResult = {
  generatedAt: string;
  run: {id: string; createdAt: string; effectiveCpus: number};
  status: AnnotationTransferStatus;
  statusExplanation: string;
  transfer: {
    referenceFeatures: number;
    referenceFeaturesByType: Record<string, number>;
    mappedFeatures: number;
    mappedFeaturesByType: Record<string, number>;
    unmappedFeatures: number;
    unmappedFeaturesByType: Record<string, number>;
    mappingFraction: number;
    targetFeatureCopies: number;
    targetFeatureCopiesByType: Record<string, number>;
    featuresWithExtraCopies: number;
    featuresWithExtraCopiesByType: Record<string, number>;
    extraCopies: number;
    miniprotRescues: number;
    transferMethodsByTargetCopy: Record<string, number>;
    changedPrimaryProteinCodingFeatures: number;
    mutationClassificationsByTargetCopy: Record<string, number>;
    dnaIdentityByTranscriptModel: IdentitySummary;
    proteinIdentityByTranscriptModel: IdentitySummary;
  };
  validation: {status: 'passed' | 'failed'; errors: number; warnings: number};
  /** Persisted one-line explanations keyed by metric and detail-column name. */
  definitions: {metrics: Record<string, string>; detailColumns: Record<string, string>};
  reports: Record<string, ResultPath>;
  evidence: Record<string, ResultPath & {recordedAvailable: boolean}>;
  metricsPath: ResultPath;
};

export type ResultValidationIssue = {path: string; message: string};

export class AnnotationTransferResultError extends Error {
  readonly issues: readonly ResultValidationIssue[];

  constructor(issues: ResultValidationIssue[]) {
    super(`Invalid annotation-transfer result:\n${issues.map(issue => `- ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'AnnotationTransferResultError';
    this.issues = issues;
  }
}

type RecordValue = Record<string, unknown>;
type Issues = ResultValidationIssue[];

function record(value: unknown, path: string, issues: Issues): RecordValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({path, message: 'must be an object'});
    return undefined;
  }
  return value as RecordValue;
}

function fields(value: RecordValue, allowed: readonly string[], path: string, issues: Issues): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      issues.push({path: `${path}.${key}`, message: 'unknown field'});
    }
  }
}

function stringValue(value: unknown, path: string, issues: Issues): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({path, message: 'must be a non-empty string'});
    return undefined;
  }
  return value;
}

function count(value: unknown, path: string, issues: Issues): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    issues.push({path, message: 'must be a non-negative integer'});
    return undefined;
  }
  return value as number;
}

function finiteNumber(value: unknown, path: string, issues: Issues): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({path, message: 'must be a finite number'});
    return undefined;
  }
  return value;
}

function countMap(value: unknown, path: string, issues: Issues): Record<string, number> | undefined {
  const source = record(value, path, issues);
  if (!source) {
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(source)) {
    const parsed = count(item, `${path}.${key}`, issues);
    if (parsed !== undefined) {
      result[key] = parsed;
    }
  }
  return result;
}

function sumCounts(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function requireEqualCount(
  actual: number,
  expected: number,
  path: string,
  description: string,
  issues: Issues,
): void {
  if (actual !== expected) {
    issues.push({path, message: `must equal ${description} (${String(expected)})`});
  }
}

function stringMap(value: unknown, path: string, issues: Issues): Record<string, string> | undefined {
  const source = record(value, path, issues);
  if (!source) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    const parsed = stringValue(item, `${path}.${key}`, issues);
    if (parsed !== undefined) {
      result[key] = parsed;
    }
  }
  return result;
}

function workflowIdentity(value: unknown, path: string, issues: Issues): void {
  const workflow = record(value, path, issues);
  if (!workflow) {
    return;
  }
  fields(workflow, ['id', 'version'], path, issues);
  if (workflow.id !== ANNOTATION_TRANSFER_WORKFLOW_ID) {
    issues.push({path: `${path}.id`, message: `must equal '${ANNOTATION_TRANSFER_WORKFLOW_ID}'`});
  }
  if (workflow.version !== ANNOTATION_TRANSFER_WORKFLOW_VERSION) {
    issues.push({path: `${path}.version`, message: `must equal supported version ${ANNOTATION_TRANSFER_WORKFLOW_VERSION}`});
  }
}

function identitySummary(value: unknown, path: string, issues: Issues): IdentitySummary | undefined {
  const source = record(value, path, issues);
  if (!source) {
    return undefined;
  }
  fields(source, ['unit', 'count', 'minimum', 'mean', 'maximum', 'unavailable_reason'], path, issues);
  if (source.unit !== 'transcript_model') {
    issues.push({path: `${path}.unit`, message: "must equal 'transcript_model'"});
  }
  const parsedCount = count(source.count, `${path}.count`, issues);
  const parseNullable = (field: 'minimum' | 'mean' | 'maximum'): number | null | undefined =>
    source[field] === null ? null : finiteNumber(source[field], `${path}.${field}`, issues);
  const minimum = parseNullable('minimum');
  const mean = parseNullable('mean');
  const maximum = parseNullable('maximum');
  const unavailableReason = source.unavailable_reason === undefined
    ? undefined
    : stringValue(source.unavailable_reason, `${path}.unavailable_reason`, issues);

  if (parsedCount === 0) {
    if (minimum !== null || mean !== null || maximum !== null || !unavailableReason) {
      issues.push({path, message: 'a zero-count identity summary requires null statistics and an unavailable reason'});
    }
  } else if (parsedCount !== undefined) {
    if (minimum === null || mean === null || maximum === null) {
      issues.push({path, message: 'a non-zero identity summary requires numeric statistics'});
    } else if (minimum !== undefined && mean !== undefined && maximum !== undefined) {
      if (minimum < 0 || maximum > 1) {
        issues.push({path, message: 'identity fractions must be between 0 and 1'});
      }
      if (minimum > mean || mean > maximum) {
        issues.push({path, message: 'identity statistics must satisfy minimum <= mean <= maximum'});
      }
    }
  }
  if (parsedCount === undefined || minimum === undefined || mean === undefined || maximum === undefined) {
    return undefined;
  }
  return {unit: 'transcript_model', count: parsedCount, minimum, mean, maximum, ...(unavailableReason ? {unavailableReason} : {})};
}

function safeRelativePath(value: unknown, path: string, runDirectory: string, issues: Issues): ResultPath | undefined {
  const parsed = stringValue(value, path, issues);
  if (!parsed) {
    return undefined;
  }
  if (isAbsolute(parsed)) {
    issues.push({path, message: 'must be relative to the run directory'});
    return undefined;
  }
  const runRoot = resolve(runDirectory);
  const absolutePath = resolve(runRoot, parsed);
  const fromRoot = relative(runRoot, absolutePath);
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    issues.push({path, message: 'must not traverse outside the run directory'});
    return undefined;
  }
  return {path: parsed, absolutePath, available: false};
}

async function checkPath(path: ResultPath): Promise<ResultPath> {
  try {
    await stat(path.absolutePath);
    return {...path, available: true};
  } catch {
    return path;
  }
}

function parseTransfer(value: unknown, issues: Issues): AnnotationTransferResult['transfer'] | undefined {
  const path = '$.metrics.payload.transfer';
  const source = record(value, path, issues);
  if (!source) {
    return undefined;
  }
  const keys = [
    'reference_features', 'reference_features_by_type', 'mapped_features', 'mapped_features_by_type',
    'unmapped_features', 'unmapped_features_by_type', 'mapping_fraction', 'target_feature_copies',
    'target_feature_copies_by_type', 'features_with_extra_copies', 'features_with_extra_copies_by_type',
    'extra_copies', 'miniprot_rescues', 'transfer_methods_by_target_copy',
    'changed_primary_protein_coding_features', 'mutation_classifications_by_target_copy',
    'dna_identity_by_transcript_model', 'protein_identity_by_transcript_model',
    'authoritative_sources', 'detail_enrichment_source',
  ] as const;
  fields(source, keys, path, issues);
  const c = (key: string) => count(source[key], `${path}.${key}`, issues);
  const m = (key: string) => countMap(source[key], `${path}.${key}`, issues);
  const referenceFeatures = c('reference_features');
  const referenceFeaturesByType = m('reference_features_by_type');
  const mappedFeatures = c('mapped_features');
  const mappedFeaturesByType = m('mapped_features_by_type');
  const unmappedFeatures = c('unmapped_features');
  const unmappedFeaturesByType = m('unmapped_features_by_type');
  const mappingFraction = finiteNumber(source.mapping_fraction, `${path}.mapping_fraction`, issues);
  if (mappingFraction !== undefined && (mappingFraction < 0 || mappingFraction > 1)) {
    issues.push({path: `${path}.mapping_fraction`, message: 'must be between 0 and 1'});
  }
  const targetFeatureCopies = c('target_feature_copies');
  const targetFeatureCopiesByType = m('target_feature_copies_by_type');
  const featuresWithExtraCopies = c('features_with_extra_copies');
  const featuresWithExtraCopiesByType = m('features_with_extra_copies_by_type');
  const extraCopies = c('extra_copies');
  const miniprotRescues = c('miniprot_rescues');
  const transferMethodsByTargetCopy = m('transfer_methods_by_target_copy');
  const changedPrimaryProteinCodingFeatures = c('changed_primary_protein_coding_features');
  const mutationClassificationsByTargetCopy = m('mutation_classifications_by_target_copy');
  const dnaIdentityByTranscriptModel = identitySummary(source.dna_identity_by_transcript_model, `${path}.dna_identity_by_transcript_model`, issues);
  const proteinIdentityByTranscriptModel = identitySummary(source.protein_identity_by_transcript_model, `${path}.protein_identity_by_transcript_model`, issues);
  if (!Array.isArray(source.authoritative_sources) || source.authoritative_sources.some(item => typeof item !== 'string')) {
    issues.push({path: `${path}.authoritative_sources`, message: 'must be an array of paths'});
  }
  stringValue(source.detail_enrichment_source, `${path}.detail_enrichment_source`, issues);
  if ([referenceFeatures, referenceFeaturesByType, mappedFeatures, mappedFeaturesByType, unmappedFeatures,
    unmappedFeaturesByType, mappingFraction, targetFeatureCopies, targetFeatureCopiesByType,
    featuresWithExtraCopies, featuresWithExtraCopiesByType, extraCopies, miniprotRescues,
    transferMethodsByTargetCopy, changedPrimaryProteinCodingFeatures, mutationClassificationsByTargetCopy,
    dnaIdentityByTranscriptModel, proteinIdentityByTranscriptModel].some(item => item === undefined)) {
    return undefined;
  }

  requireEqualCount(sumCounts(referenceFeaturesByType!), referenceFeatures!, `${path}.reference_features_by_type`, 'reference_features', issues);
  requireEqualCount(sumCounts(mappedFeaturesByType!), mappedFeatures!, `${path}.mapped_features_by_type`, 'mapped_features', issues);
  requireEqualCount(sumCounts(unmappedFeaturesByType!), unmappedFeatures!, `${path}.unmapped_features_by_type`, 'unmapped_features', issues);
  requireEqualCount(sumCounts(targetFeatureCopiesByType!), targetFeatureCopies!, `${path}.target_feature_copies_by_type`, 'target_feature_copies', issues);
  requireEqualCount(sumCounts(featuresWithExtraCopiesByType!), featuresWithExtraCopies!, `${path}.features_with_extra_copies_by_type`, 'features_with_extra_copies', issues);
  requireEqualCount(mappedFeatures! + unmappedFeatures!, referenceFeatures!, `${path}.reference_features`, 'mapped_features plus unmapped_features', issues);
  requireEqualCount(mappedFeatures! + extraCopies!, targetFeatureCopies!, `${path}.target_feature_copies`, 'mapped_features plus extra_copies', issues);
  requireEqualCount(sumCounts(transferMethodsByTargetCopy!), targetFeatureCopies!, `${path}.transfer_methods_by_target_copy`, 'target_feature_copies', issues);
  if (featuresWithExtraCopies! > mappedFeatures!) {
    issues.push({path: `${path}.features_with_extra_copies`, message: 'must not exceed mapped_features'});
  }
  if (extraCopies! < featuresWithExtraCopies!) {
    issues.push({path: `${path}.extra_copies`, message: 'must be at least features_with_extra_copies'});
  }
  if (miniprotRescues! > mappedFeatures!) {
    issues.push({path: `${path}.miniprot_rescues`, message: 'must not exceed mapped_features'});
  }
  if (changedPrimaryProteinCodingFeatures! > mappedFeatures!) {
    issues.push({path: `${path}.changed_primary_protein_coding_features`, message: 'must not exceed mapped_features'});
  }
  const expectedMappingFraction = referenceFeatures! === 0 ? 0 : mappedFeatures! / referenceFeatures!;
  if (Math.abs(mappingFraction! - expectedMappingFraction) > 1e-12) {
    issues.push({path: `${path}.mapping_fraction`, message: 'must equal mapped_features divided by reference_features'});
  }

  return {
    referenceFeatures: referenceFeatures!, referenceFeaturesByType: referenceFeaturesByType!,
    mappedFeatures: mappedFeatures!, mappedFeaturesByType: mappedFeaturesByType!,
    unmappedFeatures: unmappedFeatures!, unmappedFeaturesByType: unmappedFeaturesByType!,
    mappingFraction: mappingFraction!, targetFeatureCopies: targetFeatureCopies!,
    targetFeatureCopiesByType: targetFeatureCopiesByType!, featuresWithExtraCopies: featuresWithExtraCopies!,
    featuresWithExtraCopiesByType: featuresWithExtraCopiesByType!, extraCopies: extraCopies!,
    miniprotRescues: miniprotRescues!, transferMethodsByTargetCopy: transferMethodsByTargetCopy!,
    changedPrimaryProteinCodingFeatures: changedPrimaryProteinCodingFeatures!,
    mutationClassificationsByTargetCopy: mutationClassificationsByTargetCopy!,
    dnaIdentityByTranscriptModel: dnaIdentityByTranscriptModel!,
    proteinIdentityByTranscriptModel: proteinIdentityByTranscriptModel!,
  };
}

/** Strictly validates schema v1 and resolves its persisted paths inside the run directory. */
export async function readAnnotationTransferResult(
  value: unknown,
  runDirectory: string,
): Promise<AnnotationTransferResult> {
  const issues: Issues = [];
  const summary = record(value, '$', issues);
  if (!summary) {
    throw new AnnotationTransferResultError(issues);
  }
  fields(summary, ['schema_version', 'generated_at', 'workflow', 'run', 'status', 'status_explanation', 'metrics', 'generated_reports', 'source_evidence'], '$', issues);
  if (summary.schema_version !== ANNOTATION_TRANSFER_SUMMARY_SCHEMA_VERSION) {
    issues.push({path: '$.schema_version', message: `must equal supported version ${ANNOTATION_TRANSFER_SUMMARY_SCHEMA_VERSION}`});
  }
  workflowIdentity(summary.workflow, '$.workflow', issues);
  const generatedAt = stringValue(summary.generated_at, '$.generated_at', issues);
  const statusValues: AnnotationTransferStatus[] = ['completed', 'completed-with-warnings', 'validation-failed'];
  if (!statusValues.includes(summary.status as AnnotationTransferStatus)) {
    issues.push({path: '$.status', message: `must be one of: ${statusValues.join(', ')}`});
  }
  const statusExplanation = stringValue(summary.status_explanation, '$.status_explanation', issues);

  const run = record(summary.run, '$.run', issues);
  let runModel: AnnotationTransferResult['run'] | undefined;
  if (run) {
    fields(run, ['id', 'created_at', 'effective_cpus'], '$.run', issues);
    const id = stringValue(run.id, '$.run.id', issues);
    const createdAt = stringValue(run.created_at, '$.run.created_at', issues);
    const effectiveCpus = count(run.effective_cpus, '$.run.effective_cpus', issues);
    if (effectiveCpus === 0) {
      issues.push({path: '$.run.effective_cpus', message: 'must be positive'});
    }
    if (id && createdAt && effectiveCpus) {
      runModel = {id, createdAt, effectiveCpus};
    }
  }

  const metrics = record(summary.metrics, '$.metrics', issues);
  let transfer: AnnotationTransferResult['transfer'] | undefined;
  let validation: AnnotationTransferResult['validation'] | undefined;
  let metricsPath: ResultPath | undefined;
  let definitions: AnnotationTransferResult['definitions'] | undefined;
  if (metrics) {
    fields(metrics, ['schema_version', 'path', 'payload'], '$.metrics', issues);
    if (metrics.schema_version !== ANNOTATION_TRANSFER_METRICS_SCHEMA_VERSION) {
      issues.push({path: '$.metrics.schema_version', message: `must equal supported version ${ANNOTATION_TRANSFER_METRICS_SCHEMA_VERSION}`});
    }
    metricsPath = safeRelativePath(metrics.path, '$.metrics.path', runDirectory, issues);
    const payload = record(metrics.payload, '$.metrics.payload', issues);
    if (payload) {
      fields(payload, ['schema_version', 'generated_at', 'workflow', 'definitions', 'detail_column_definitions', 'transfer', 'validation'], '$.metrics.payload', issues);
      if (payload.schema_version !== ANNOTATION_TRANSFER_METRICS_SCHEMA_VERSION) {
        issues.push({path: '$.metrics.payload.schema_version', message: `must equal supported version ${ANNOTATION_TRANSFER_METRICS_SCHEMA_VERSION}`});
      }
      workflowIdentity(payload.workflow, '$.metrics.payload.workflow', issues);
      stringValue(payload.generated_at, '$.metrics.payload.generated_at', issues);
      const metricDefinitions = stringMap(payload.definitions, '$.metrics.payload.definitions', issues);
      const detailColumnDefinitions = stringMap(payload.detail_column_definitions, '$.metrics.payload.detail_column_definitions', issues);
      if (metricDefinitions && detailColumnDefinitions) {
        definitions = {metrics: metricDefinitions, detailColumns: detailColumnDefinitions};
      }
      transfer = parseTransfer(payload.transfer, issues);
      const validationSource = record(payload.validation, '$.metrics.payload.validation', issues);
      if (validationSource) {
        fields(validationSource, ['status', 'errors', 'warnings', 'source', 'explanation'], '$.metrics.payload.validation', issues);
        if (validationSource.status !== 'passed' && validationSource.status !== 'failed') {
          issues.push({path: '$.metrics.payload.validation.status', message: "must be 'passed' or 'failed'"});
        }
        const errors = count(validationSource.errors, '$.metrics.payload.validation.errors', issues);
        const warnings = count(validationSource.warnings, '$.metrics.payload.validation.warnings', issues);
        stringValue(validationSource.source, '$.metrics.payload.validation.source', issues);
        stringValue(validationSource.explanation, '$.metrics.payload.validation.explanation', issues);
        if ((validationSource.status === 'passed' || validationSource.status === 'failed') && errors !== undefined && warnings !== undefined) {
          validation = {status: validationSource.status, errors, warnings};
        }
      }
    }
  }

  const reportsSource = record(summary.generated_reports, '$.generated_reports', issues);
  const reports: Record<string, ResultPath> = {};
  if (reportsSource) {
    const expected = ['feature_transfer', 'aggregated_metrics', 'completion_summary', 'validation'];
    fields(reportsSource, expected, '$.generated_reports', issues);
    for (const key of expected) {
      const parsed = safeRelativePath(reportsSource[key], `$.generated_reports.${key}`, runDirectory, issues);
      if (parsed) {
        reports[key] = parsed;
      }
    }
  }

  const evidenceSource = record(summary.source_evidence, '$.source_evidence', issues);
  const evidence: Record<string, ResultPath & {recordedAvailable: boolean}> = {};
  const evidenceKeys = ['raw_gff3', 'lifton_diagnostics', 'run_manifest', 'completeness_by_feature_type', 'mapped_features', 'mapped_transcripts', 'unmapped_features', 'extra_copy_features', 'selected_feature_types'];
  if (evidenceSource) {
    fields(evidenceSource, evidenceKeys, '$.source_evidence', issues);
    for (const key of evidenceKeys) {
      const entry = record(evidenceSource[key], `$.source_evidence.${key}`, issues);
      if (!entry) {
        continue;
      }
      fields(entry, ['path', 'available'], `$.source_evidence.${key}`, issues);
      if (typeof entry.available !== 'boolean') {
        issues.push({path: `$.source_evidence.${key}.available`, message: 'must be a boolean'});
      }
      const parsed = safeRelativePath(entry.path, `$.source_evidence.${key}.path`, runDirectory, issues);
      if (parsed && typeof entry.available === 'boolean') {
        evidence[key] = {...parsed, recordedAvailable: entry.available};
      }
    }
  }

  if (validation) {
    if (validation.status === 'failed' && validation.errors === 0) {
      issues.push({path: '$.metrics.payload.validation.errors', message: 'must be positive when validation failed'});
    }
    if (validation.status === 'passed' && validation.errors !== 0) {
      issues.push({path: '$.metrics.payload.validation.errors', message: 'must be zero when validation passed'});
    }
    const expectedStatus: AnnotationTransferStatus = validation.status === 'failed'
      ? 'validation-failed'
      : validation.warnings > 0
        ? 'completed-with-warnings'
        : 'completed';
    if (summary.status !== expectedStatus) {
      issues.push({path: '$.status', message: `must equal '${expectedStatus}' for the persisted validation result`});
    }
  }

  if (issues.length > 0 || !generatedAt || !runModel || !statusExplanation || !transfer || !validation || !metricsPath || !definitions) {
    throw new AnnotationTransferResultError(issues);
  }

  const checkedReports = Object.fromEntries(await Promise.all(Object.entries(reports).map(async ([key, path]) => [key, await checkPath(path)])));
  const checkedEvidence = Object.fromEntries(await Promise.all(Object.entries(evidence).map(async ([key, path]) => {
    const checked = await checkPath(path);
    return [key, {...checked, recordedAvailable: path.recordedAvailable}];
  })));
  return {
    generatedAt, run: runModel, status: summary.status as AnnotationTransferStatus,
    statusExplanation, transfer, validation, definitions,
    reports: checkedReports, evidence: checkedEvidence,
    metricsPath: await checkPath(metricsPath),
  };
}
