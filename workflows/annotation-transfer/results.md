# Annotation transfer results

This page explains every item of the annotation transfer result page, grouped by its tabs. The counts and their values are those of the pinned LiftOn release (see *Tools* in the README); how the transfer works is explained in the workflow's [README](README.md). The Run Details tab and the run files every workflow shows are explained in the general [run results](../../docs/run-results.md) page.

## Overview

The overview shows the execution outcome, the workflow's own status, and the check of the final annotation.

### Run status

The scientific status saved by the workflow. A Snakemake process that exits successfully can still produce a failed validation, so this status, not the process exit, tells whether the result is usable. Paths marked missing do not exist now; paths marked with their availability when summarized existed or were absent when the summary was written.

| Status | Meaning |
|---|---|
| `completed` | Transfer finished and the final GFF3 passed validation without warnings. |
| `completed-with-warnings` | Transfer finished and the final GFF3 passed validation, but warnings need review. |
| `validation-failed` | Transfer finished, but the final GFF3 has structural errors. All evidence is kept for review; do not use the annotation downstream without fixing the errors. |

### Final GFF3 structural validation

| Item | Meaning |
|---|---|
| Status | Result of the structural check of the final GFF3: passed or failed. It checks the GFF3 version header, coordinates, strand, CDS phase, identifiers, and parent relationships, not biological correctness. A failed check is a scientific result that is kept for review, not a failed workflow execution. |
| Errors | Structural problems in the final GFF3 that make it unsafe for downstream use. Any error sets the run status to `validation-failed`. The validation report lists each error. |
| Warnings | Structural findings in the final GFF3 that should be reviewed but do not block downstream use. Warnings without errors set the run status to `completed-with-warnings`. |

## Transfer

| Item | Meaning |
|---|---|
| Reference features selected for transfer | The top-level features of the reference GFF3 (usually genes) whose types LiftOn selected for transfer. Every other count on this page that mentions reference features uses this set as its unit and denominator. Child features such as transcripts, exons, and CDS are transferred with their parent and are not counted here. |
| Selected reference features by type | The selected reference features split by their GFF3 type. The types are chosen by LiftOn and recorded in the selected feature types report under source evidence. |
| Mapped reference features | Selected reference features that LiftOn placed at least once on the target assembly. A reference feature with several target copies is still counted once. |
| Unmapped reference features | Selected reference features for which LiftOn produced no target copy. They keep a row with empty target fields in the per-feature transfer TSV. |
| Mapped share of selected reference features | Mapped reference features divided by selected reference features. Additional copies do not increase this share, and transcripts are not counted separately. |
| Target copies (primary and additional) | Every feature copy LiftOn wrote to the target annotation: one primary copy for each mapped reference feature plus all additional copies. This is the unit of the transfer method and mutation class breakdowns. |
| Reference features with additional copies | Reference features that LiftOn placed more than once on the target assembly, for example after a duplication. Each such reference feature is counted once, however many additional copies it has. |
| Additional target copies | The number of target copies beyond the primary copy, summed over all reference features. In the per-feature TSV these rows have status `extra-copy` and a positive copy number. |
| Genes added by the miniprot rescue pass | Genes added by LiftOn's separate miniprot rescue pass: coding genes that the Liftoff DNA lift missed entirely and that the regular miniprot step also did not emit. The unit is genes as reported by LiftOn. Genes from the regular miniprot step are not included here; they appear under the transfer method `miniprot`. |
| Target copies by transfer method | Target copies grouped by how LiftOn placed the gene; see *Transfer methods* below. The value comes from the gene-level `source` attribute; when that attribute is absent, the transcript-level `status` values are listed instead, joined by commas when a gene has several. |

### Transfer methods

| Value | Meaning |
|---|---|
| `Liftoff` | Placed by Liftoff, which aligns the reference gene sequence to the target assembly. As a transcript status it means LiftOn kept the Liftoff model rather than a chained or miniprot model. |
| `miniprot` | Placed from a miniprot alignment of the reference protein at a locus where Liftoff placed no gene, either by the regular miniprot step or by the rescue pass. |
| `LiftOn_chaining_algorithm` | Transcript status: LiftOn combined parts of the Liftoff and miniprot alignments to obtain a protein closer to the reference. |
| `LiftOn_miniprot` | Transcript status: LiftOn replaced the Liftoff model with the miniprot model because it gave a strictly higher protein identity. |
| `no_ref_protein` | Transcript status: no reference protein was available, so no protein-based refinement was possible. |

## Model evidence

| Item | Meaning |
|---|---|
| Coding reference features with a protein change or loss in the primary copy | Mapped protein-coding reference features whose primary target copy carries at least one mutation class other than `identical` or `synonymous`: its predicted protein differs from the reference, or the transcript or protein could not be aligned at all (`full_transcript_loss`, `no_protein`). Classes found only on additional copies do not count. |
| Target copies by mutation class | For each LiftOn mutation class (see *Mutation classes* below), the number of target copies with at least one transcript carrying it. These are not counts of individual mutation events, and one copy can carry several classes, so the counts can add up to more than the number of target copies. |
| DNA identity per transcript model | LiftOn aligns each transferred transcript sequence to its reference transcript and records the share of identical aligned positions as `dna_identity`. The summary gives the minimum, mean, and maximum over all transcript models carrying that value; 100% means the transcript sequence is unchanged. |
| Protein identity per transcript model | LiftOn translates each transferred coding transcript and records the share of identical aligned amino acids against the reference protein as `protein_identity`. Non-coding transcripts carry no value. The summary gives the minimum, mean, and maximum over all transcript models carrying it. Protein identity can stay at 100% while DNA identity is lower, because synonymous changes do not alter the protein. |

### Mutation classes

| Value | Meaning |
|---|---|
| `identical` | The transcript sequence is identical to the reference. |
| `synonymous` | The transcript sequence differs, but the predicted protein is identical. |
| `nonsynonymous` | The protein differs through amino-acid substitutions only; it still ends at a regular stop codon and no other class applies. |
| `frameshift` | An insertion or deletion in the coding sequence whose length is not a multiple of three shifts the reading frame. |
| `start_lost` | The first amino acid of the predicted protein differs from the reference and is not methionine. |
| `inframe_insertion` | The protein differs, no coding frameshift was found, and the target transcript has extra bases somewhere in its alignment, including the UTRs. LiftOn does not check that the insertion lies in the coding sequence or that its length is a multiple of three. |
| `inframe_deletion` | The protein differs, no coding frameshift was found, and the target transcript lacks bases somewhere in its alignment, including the UTRs. LiftOn does not check that the deletion lies in the coding sequence or that its length is a multiple of three. |
| `stop_missing` | The predicted protein has no stop codon. |
| `stop_codon_gain` | A premature stop codon truncates the predicted protein. |
| `non_coding` | The reference transcript is non-coding, so no protein was compared. |
| `full_transcript_loss` | The transcript sequence could not be aligned to the reference at all. |
| `no_protein` | The transcript aligned, but no protein could be aligned to the reference protein. |

## Files

The run directory and the run's own files are explained in the general run results page.

### Generated reports

| Item | Meaning |
|---|---|
| Per-feature transfer table (TSV) | One row per selected reference feature and per target copy, with raw LiftOn target identifiers, coordinates, transfer method, lowest identities, and mutation classes. Target identifiers are the raw LiftOn IDs; later identifier rewriting may change them in the final GFF3. |
| Metrics (JSON) | All metrics shown on this page with their persisted one-line definitions, in machine-readable form. |
| Completion summary (JSON) | The entry point read by this application: run status, the metrics, and links to all reports and evidence. |
| Validation report (JSON) | Every structural validation error and warning found in the final GFF3. |
| Final GFF3 | The annotation passed to downstream stages: the raw LiftOn GFF3 after optional identifier prefixing. |

### Source evidence

| Item | Meaning |
|---|---|
| Raw LiftOn GFF3 | The unmodified GFF3 written by LiftOn. It supplies coordinates, identities, and mutation classes for the per-feature table, but LiftOn's structured reports stay authoritative for the counts. |
| LiftOn output directory | The complete LiftOn output directory, including statistics, intermediate files, and its own logs. |
| LiftOn run manifest | LiftOn's machine-readable record of its run, including the counts cross-checked against the other reports. |
| LiftOn completeness by feature type | LiftOn's per-type table of selected, lifted, missed, and additional features. |
| LiftOn mapped features | LiftOn's list of mapped reference features with their copy count and category. |
| LiftOn mapped transcripts | LiftOn's list of mapped reference transcripts with their copy count and category. |
| LiftOn unmapped features | LiftOn's list of reference features it could not place on the target assembly. |
| LiftOn extra-copy features | LiftOn's list of reference features placed more than once, with their copy count. |
| LiftOn selected feature types | The top-level feature types LiftOn selected for transfer from the reference GFF3. |
