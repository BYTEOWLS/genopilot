import React from 'react';
import {Box} from 'ink';
import type {AnnotationTransferResult, ResultPath,} from '../../workflows/annotation-transfer/results.js';
import type {TabDefinition} from '../components/tabs.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {SectionList, type SectionListItem} from './section-list.js';

export type AnnotationTransferTabId = 'overview' | 'transfer' | 'evidence' | 'proteins' | 'files' | 'run';

export const annotationTransferTabs: readonly TabDefinition<AnnotationTransferTabId>[] = [
  {id: 'overview', label: 'Overview'},
  {id: 'transfer', label: 'Transfer'},
  {id: 'evidence', label: 'Model Evidence'},
  {id: 'proteins', label: 'Proteins'},
  {id: 'files', label: 'Files'},
  {id: 'run', label: 'Run Details'},
];

export type ResultSection = {id: string; tab: AnnotationTransferTabId; title: string; items: SectionListItem[]};

const reportLabels: Record<string, string> = {
  feature_transfer: 'Per-feature transfer table (TSV)',
  aggregated_metrics: 'Metrics (JSON)',
  completion_summary: 'Completion summary (JSON)',
  validation: 'Validation report (JSON)',
  target_unresolved_bed: 'Target unresolved bases (BED)',
};

const evidenceLabels: Record<string, string> = {
  raw_gff3: 'Raw LiftOn GFF3',
  lifton_diagnostics: 'LiftOn output directory',
  run_manifest: 'LiftOn run manifest',
  completeness_by_feature_type: 'LiftOn completeness by feature type',
  mapped_features: 'LiftOn mapped features',
  mapped_transcripts: 'LiftOn mapped transcripts',
  unmapped_features: 'LiftOn unmapped features',
  extra_copy_features: 'LiftOn extra-copy features',
  selected_feature_types: 'LiftOn selected feature types',
};

function countMap(values: Record<string, number>): string {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? 'none'
    : entries.map(([key, value]) => `${sanitizeTerminalText(key)}: ${String(value)}`).join(', ');
}

function identitySummary(
  value: AnnotationTransferResult['transfer']['dnaIdentityByTranscriptModel'],
): string {
  if (value.count === 0) {
    return `unavailable (${sanitizeTerminalText(value.unavailableReason ?? 'no transcript models')})`;
  }
  return `${String(value.count)} transcript models; min ${(value.minimum! * 100).toFixed(1)}%, mean ${(value.mean! * 100).toFixed(1)}%, max ${(value.maximum! * 100).toFixed(1)}%`;
}

function resultPathItem(
    id: string,
    label: string,
    value: ResultPath & { recordedAvailable?: boolean },
): SectionListItem {
  const availability = value.available ? '' : ' (missing)';
  const recordedAvailability = value.recordedAvailable === undefined || value.recordedAvailable === value.available
    ? ''
    : value.recordedAvailable
      ? ' (available when summarized)'
      : ' (unavailable when summarized; available now)';
  return {
    id,
    label,
    value: `${sanitizeTerminalText(value.path)}${availability}${recordedAvailability}`,
    color: value.available ? undefined : 'yellow',
  };
}

function pathItems(
    idPrefix: string,
    labels: Record<string, string>,
    paths: Record<string, (ResultPath & { recordedAvailable?: boolean }) | undefined>,
): SectionListItem[] {
  return Object.entries(labels).flatMap(([key, label]) => {
    const value = paths[key];
    return value ? [resultPathItem(`${idPrefix}.${key}`, label, value)] : [];
  });
}

function unresolvedBasesItem(value: AnnotationTransferResult['proteins']['unresolvedTargetBases']): SectionListItem {
  const total = value.n + value.other;
  return {id: 'proteins.unresolved_target_bases', label: 'Target bases that are not A, C, G, or T',
    value: total === 0 ? 'none' : `${value.n.toLocaleString('en-US')} N, ${value.other.toLocaleString('en-US')} other codes; genes containing them are listed for review`,
    color: total > 0 ? 'yellow' : undefined};
}

/** Result items grouped into sections; item IDs are stable metric or path keys. */
function annotationTransferSections(result: AnnotationTransferResult): ResultSection[] {
  const transfer = result.transfer;
  return [
    {
      id: 'transfer',
      tab: 'transfer',
      title: 'Transfer',
      items: [
        {id: 'reference_features', label: 'Reference features selected for transfer', value: transfer.referenceFeatures},
        {id: 'reference_features_by_type', label: 'Selected reference features by type', value: countMap(transfer.referenceFeaturesByType)},
        {id: 'mapped_features', label: 'Mapped reference features', value: transfer.mappedFeatures},
        {id: 'unmapped_features', label: 'Unmapped reference features', value: transfer.unmappedFeatures},
        {id: 'mapping_fraction', label: 'Mapped share of selected reference features', value: `${(transfer.mappingFraction * 100).toFixed(1)}%`},
        {id: 'target_feature_copies', label: 'Target copies (primary and additional)', value: transfer.targetFeatureCopies},
        {id: 'features_with_extra_copies', label: 'Reference features with additional copies', value: transfer.featuresWithExtraCopies},
        {id: 'extra_copies', label: 'Additional target copies', value: transfer.extraCopies},
        {id: 'miniprot_rescues', label: 'Genes added by the miniprot rescue pass', value: transfer.miniprotRescues},
        {id: 'transfer_methods_by_target_copy', label: 'Target copies by transfer method', value: countMap(transfer.transferMethodsByTargetCopy)},
      ],
    },
    {
      id: 'model-evidence',
      tab: 'evidence',
      title: 'Model Evidence',
      items: [
        {
          id: 'changed_primary_protein_coding_features',
          label: 'Coding reference features with a protein change or loss in the primary copy',
          value: transfer.changedPrimaryProteinCodingFeatures,
        },
        {id: 'mutation_classifications_by_target_copy', label: 'Target copies by mutation class', value: countMap(transfer.mutationClassificationsByTargetCopy)},
        {id: 'dna_identity_by_transcript_model', label: 'DNA identity per transcript model', value: identitySummary(transfer.dnaIdentityByTranscriptModel)},
        {id: 'protein_identity_by_transcript_model', label: 'Protein identity per transcript model', value: identitySummary(transfer.proteinIdentityByTranscriptModel)},
      ],
    },
    {
      id: 'unresolved-bases',
      tab: 'overview',
      title: 'Target Sequence',
      items: [unresolvedBasesItem(result.proteins.unresolvedTargetBases)],
    },
    {
      id: 'validation',
      tab: 'overview',
      title: 'Transferred GFF3 Structural Validation',
      items: [
        {id: 'validation.status', label: 'Status', value: result.validation.status, row: true},
        {id: 'validation.errors', label: 'Errors', value: result.validation.errors, row: true, color: result.validation.errors > 0 ? 'red' : undefined},
        {id: 'validation.warnings', label: 'Warnings', value: result.validation.warnings, row: true, color: result.validation.warnings > 0 ? 'yellow' : undefined},
      ],
    },
    {id: 'reports', tab: 'files', title: 'Generated Reports', items: pathItems('report', reportLabels, result.reports)},
    {id: 'evidence', tab: 'files', title: 'Source Evidence', items: pathItems('evidence', evidenceLabels, result.evidence)},
  ];
}

/**
 * The tab content of an annotation-transfer result; workflow-specific presentation only, all
 * scientific parsing stays in the result reader.
 */
export function AnnotationTransferResults({
  result,
  tab,
  overviewHeader,
  filesHeader,
  filesFooter,
  runDetails,
  proteins,
}: {
  result: AnnotationTransferResult;
  tab: AnnotationTransferTabId;
  /** The execution outcome and run status, shown above the validation. */
  overviewHeader: React.ReactNode;
  /** The run directory, shown above the reports. */
  filesHeader: React.ReactNode;
  /** The run's own files, shown below the source evidence. */
  filesFooter: React.ReactNode;
  /** The run's technical metadata, on a tab of its own. */
  runDetails: React.ReactNode;
  /** The Proteins tab's rating and review list, owned by `useProteinReview`. */
  proteins: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {tab === 'overview' ? overviewHeader : null}
      {tab === 'files' ? filesHeader : null}
      {annotationTransferSections(result).filter(section => section.tab === tab).map(section => (
        <SectionList key={section.id} title={section.title} items={section.items} />
      ))}
      {tab === 'files' ? filesFooter : null}
      {tab === 'proteins' ? proteins : null}
      {tab === 'run' ? runDetails : null}
    </Box>
  );
}
