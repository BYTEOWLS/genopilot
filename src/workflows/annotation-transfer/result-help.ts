/**
 * Longer explanations for annotation-transfer workflow version 1 results.
 *
 * Short definitions are persisted with each run by the workflow; these texts interpret the
 * persisted metrics and the exact values written by the pinned LiftOn 1.0.13 release.
 */

export type ExplainedValue = {value: string; explanation: string};

/** Explanations keyed by the stable result-item IDs used on the result screen. */
export const annotationTransferExplanations: Record<string, string> = {
  reference_features:
    'The top-level features of the reference GFF3 (usually genes) whose types LiftOn selected for transfer. ' +
    'Every other count on this page that mentions reference features uses this set as its unit and denominator. ' +
    'Child features such as transcripts, exons, and CDS are transferred with their parent and are not counted here.',
  reference_features_by_type:
    'The selected reference features split by their GFF3 type. The types are chosen by LiftOn and recorded in the ' +
    'selected feature types report under source evidence.',
  mapped_features:
    'Selected reference features that LiftOn placed at least once on the target assembly. ' +
    'A reference feature with several target copies is still counted once.',
  unmapped_features:
    'Selected reference features for which LiftOn produced no target copy. ' +
    'They keep a row with empty target fields in the per-feature transfer TSV.',
  mapping_fraction:
    'Mapped reference features divided by selected reference features. ' +
    'Additional copies do not increase this share, and transcripts are not counted separately.',
  target_feature_copies:
    'Every feature copy LiftOn wrote to the target annotation: one primary copy for each mapped reference feature ' +
    'plus all additional copies. This is the unit of the transfer method and mutation class breakdowns.',
  features_with_extra_copies:
    'Reference features that LiftOn placed more than once on the target assembly, for example after a duplication. ' +
    'Each such reference feature is counted once, however many additional copies it has.',
  extra_copies:
    'The number of target copies beyond the primary copy, summed over all reference features. ' +
    'In the per-feature TSV these rows have status extra-copy and a positive copy number.',
  miniprot_rescues:
    'Genes added by LiftOn\'s separate miniprot rescue pass: coding genes that the Liftoff DNA lift missed ' +
    'entirely and that the regular miniprot step also did not emit. The unit is genes as reported by LiftOn. ' +
    'Genes from the regular miniprot step are not included here; they appear under the transfer method miniprot.',
  transfer_methods_by_target_copy:
    'Target copies grouped by how LiftOn placed the gene. The value comes from the gene-level source attribute; ' +
    'when that attribute is absent, the transcript-level status values are listed instead.',
  changed_primary_protein_coding_features:
    'Mapped protein-coding reference features whose primary target copy carries at least one mutation class other ' +
    'than identical or synonymous: its predicted protein differs from the reference, or the transcript or protein ' +
    'could not be aligned at all (full_transcript_loss, no_protein). ' +
    'Classes found only on additional copies do not count.',
  mutation_classifications_by_target_copy:
    'For each LiftOn mutation class, the number of target copies with at least one transcript carrying it. ' +
    'These are not counts of individual mutation events, and one copy can carry several classes, ' +
    'so the counts can add up to more than the number of target copies.',
  dna_identity_by_transcript_model:
    'LiftOn aligns each transferred transcript sequence to its reference transcript and records the share of ' +
    'identical aligned positions as dna_identity. The summary gives the minimum, mean, and maximum over all ' +
    'transcript models carrying that value; 100% means the transcript sequence is unchanged.',
  protein_identity_by_transcript_model:
    'LiftOn translates each transferred coding transcript and records the share of identical aligned amino acids ' +
    'against the reference protein as protein_identity. Non-coding transcripts carry no value. The summary gives ' +
    'the minimum, mean, and maximum over all transcript models carrying it. Protein identity can stay at 100% ' +
    'while DNA identity is lower, because synonymous changes do not alter the protein.',
  'validation.status':
    'Result of the structural check of the final GFF3: passed or failed. It checks the GFF3 version header, ' +
    'coordinates, strand, CDS phase, identifiers, and parent relationships, not biological correctness. ' +
    'A failed check is a scientific result that is kept for review, not a failed workflow execution.',
  'validation.errors':
    'Structural problems in the final GFF3 that make it unsafe for downstream use. Any error sets the run status ' +
    'to validation failed. The validation report lists each error.',
  'validation.warnings':
    'Structural findings in the final GFF3 that should be reviewed but do not block downstream use. ' +
    'Warnings without errors set the run status to completed with warnings.',
  'report.feature_transfer':
    'One row per selected reference feature and per target copy, with raw LiftOn target identifiers, coordinates, ' +
    'transfer method, lowest identities, and mutation classes. Target identifiers are the raw LiftOn IDs; ' +
    'later identifier rewriting may change them in the final GFF3.',
  'report.aggregated_metrics':
    'All metrics shown on this page with their persisted one-line definitions, in machine-readable form.',
  'report.completion_summary':
    'The entry point read by this application: run status, the metrics, and links to all reports and evidence.',
  'report.validation':
    'Every structural validation error and warning found in the final GFF3.',
  'report.final_gff3':
    'The annotation passed to downstream stages: the raw LiftOn GFF3 after optional identifier prefixing.',
  'evidence.raw_gff3':
    'The unmodified GFF3 written by LiftOn. It supplies coordinates, identities, and mutation classes for the ' +
    'per-feature table, but LiftOn\'s structured reports stay authoritative for the counts.',
  'evidence.lifton_diagnostics':
    'The complete LiftOn output directory, including statistics, intermediate files, and its own logs.',
  'evidence.run_manifest':
    'LiftOn\'s machine-readable record of its run, including the counts cross-checked against the other reports.',
  'evidence.completeness_by_feature_type':
    'LiftOn\'s per-type table of selected, lifted, missed, and additional features.',
  'evidence.mapped_features':
    'LiftOn\'s list of mapped reference features with their copy count and category.',
  'evidence.mapped_transcripts':
    'LiftOn\'s list of mapped reference transcripts with their copy count and category.',
  'evidence.unmapped_features':
    'LiftOn\'s list of reference features it could not place on the target assembly.',
  'evidence.extra_copy_features':
    'LiftOn\'s list of reference features placed more than once, with their copy count.',
  'evidence.selected_feature_types':
    'The top-level feature types LiftOn selected for transfer from the reference GFF3.',
};

/**
 * Gene-level `source` values and transcript-level `status` values written by LiftOn 1.0.13.
 */
export const liftonTransferMethods: readonly ExplainedValue[] = [
  {
    value: 'Liftoff',
    explanation: 'Placed by Liftoff, which aligns the reference gene sequence to the target assembly. ' +
      'As a transcript status it means LiftOn kept the Liftoff model rather than a chained or miniprot model.',
  },
  {
    value: 'miniprot',
    explanation: 'Placed from a miniprot alignment of the reference protein at a locus where Liftoff placed no gene, ' +
      'either by the regular miniprot step or by the rescue pass.',
  },
  {
    value: 'LiftOn_chaining_algorithm',
    explanation: 'Transcript status: LiftOn combined parts of the Liftoff and miniprot alignments to obtain a protein ' +
      'closer to the reference.',
  },
  {
    value: 'LiftOn_miniprot',
    explanation: 'Transcript status: LiftOn replaced the Liftoff model with the miniprot model because it gave a ' +
      'strictly higher protein identity.',
  },
  {
    value: 'no_ref_protein',
    explanation: 'Transcript status: no reference protein was available, so no protein-based refinement was possible.',
  },
];

/** Mutation classes written by LiftOn 1.0.13 (`lifton/variants.py`). */
export const liftonMutationClasses: readonly ExplainedValue[] = [
  {value: 'identical', explanation: 'The transcript sequence is identical to the reference.'},
  {value: 'synonymous', explanation: 'The transcript sequence differs, but the predicted protein is identical.'},
  {
    value: 'nonsynonymous',
    explanation: 'The protein differs through amino-acid substitutions only; it still ends at a regular stop codon ' +
      'and no other class applies.',
  },
  {
    value: 'frameshift',
    explanation: 'An insertion or deletion in the coding sequence whose length is not a multiple of three shifts the ' +
      'reading frame.',
  },
  {
    value: 'start_lost',
    explanation: 'The first amino acid of the predicted protein differs from the reference and is not methionine.',
  },
  {
    value: 'inframe_insertion',
    explanation: 'The protein differs, no coding frameshift was found, and the target transcript has extra bases ' +
      'somewhere in its alignment, including the UTRs. LiftOn does not check that the insertion lies in the coding ' +
      'sequence or that its length is a multiple of three.',
  },
  {
    value: 'inframe_deletion',
    explanation: 'The protein differs, no coding frameshift was found, and the target transcript lacks bases ' +
      'somewhere in its alignment, including the UTRs. LiftOn does not check that the deletion lies in the coding ' +
      'sequence or that its length is a multiple of three.',
  },
  {value: 'stop_missing', explanation: 'The predicted protein has no stop codon.'},
  {value: 'stop_codon_gain', explanation: 'A premature stop codon truncates the predicted protein.'},
  {value: 'non_coding', explanation: 'The reference transcript is non-coding, so no protein was compared.'},
  {value: 'full_transcript_loss', explanation: 'The transcript sequence could not be aligned to the reference at all.'},
  {
    value: 'no_protein',
    explanation: 'The transcript aligned, but no protein could be aligned to the reference protein.',
  },
];

/** Explanations for LiftOn values attached to the result items that report them. */
export const annotationTransferValueExplanations: Record<string, readonly ExplainedValue[]> = {
  transfer_methods_by_target_copy: liftonTransferMethods,
  mutation_classifications_by_target_copy: liftonMutationClasses,
};
