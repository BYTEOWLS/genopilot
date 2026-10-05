# Annotation transfer results

This page explains every item of the annotation transfer result page, grouped by its tabs. The counts and their values are those of the pinned LiftOn release (see *Tools* in the README); how the transfer works is explained in the workflow's [README](README.md). The Run Details tab and the run files every workflow shows are explained in the general [run results](../../docs/run-results.md) page.

## Overview

The overview shows the execution outcome, the workflow's own status, and the check of the transferred annotation.

### Run status

The scientific status saved by the workflow. A Snakemake process that exits successfully can still produce a failed validation, so this status, not the process exit, tells whether the result is usable. Paths marked missing do not exist now; paths marked with their availability when summarized existed or were absent when the summary was written.

| Status | Meaning |
|---|---|
| `completed` | Transfer finished and the transferred GFF3 passed validation without warnings. |
| `completed-with-warnings` | Transfer finished and the transferred GFF3 passed validation, but warnings need review. |
| `validation-failed` | Transfer finished, but the transferred GFF3 has structural errors. All evidence is kept for review; do not use the annotation downstream without fixing the errors. |

### Transferred GFF3 structural validation

| Item | Meaning |
|---|---|
| Status | Result of the structural check of the transferred GFF3: passed or failed. It checks the GFF3 version header, coordinates, strand, CDS phase, identifiers, and parent relationships, not biological correctness. A failed check is a scientific result that is kept for review, not a failed workflow execution. |
| Errors | Structural problems in the transferred GFF3 that make it unsafe for downstream use. Any error sets the run status to `validation-failed`. The validation report lists each error. |
| Warnings | Structural findings in the transferred GFF3 that should be reviewed but do not block downstream use. Warnings without errors set the run status to `completed-with-warnings`. |

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
| Genes added by the miniprot rescue pass | Genes added by LiftOn's separate miniprot rescue pass: coding genes that the Liftoff DNA lift missed entirely and that the regular miniprot step also did not emit. The unit is genes as reported by LiftOn. Genes from the regular miniprot step are not included here; they appear under the transfer method `miniprot`. A gene the pass places at a second locus is counted as an additional target copy instead. |
| Target copies by transfer method | Target copies grouped by how LiftOn placed the gene; see *Transfer methods* below. The value comes from the gene-level `source` attribute; when that attribute is absent, the transcript-level `status` values are listed instead, joined by commas when a gene has several. |

### Transfer methods

| Value | Meaning |
|---|---|
| `Liftoff` | Placed by Liftoff, which aligns the reference gene sequence to the target assembly. As a transcript status it means LiftOn kept the Liftoff model rather than a chained or miniprot model. |
| `miniprot` | Placed from a miniprot alignment of the reference protein at a locus where Liftoff placed no gene, either by the regular miniprot step or by the rescue pass. An additional copy with this method may be a second-locus model, which the raw GFF3 marks with `lifton_rescue_second_locus=true`: a gene already placed once, added again where its protein aligns, as for the second copy of a duplicated gene. In a paralogous gene family that locus can belong to a related gene. |
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
| Per-feature transfer table (TSV) | One row per selected reference feature and per target copy, with LiftOn's target identifiers, coordinates, transfer method, lowest identities, and mutation classes. |
| Metrics (JSON) | All metrics shown on this page with their persisted one-line definitions, in machine-readable form. |
| Completion summary (JSON) | The entry point read by this application: run status, the metrics, and links to all reports and evidence. |
| Validation report (JSON) | Every structural validation error and warning found in the transferred GFF3. |

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

## Transfer genome views

Press `v` on the result page and choose *Target* or *Reference* to look at the transfer in the browser. Open this guide from the `?` help menu while a view is open. The views only show what the run produced; they change nothing.

A gene lies at different coordinates in the reference and the target, because the assemblies differ in length and order. The two views therefore cannot be shown on top of each other; open the other view to compare, which replaces the current one. The assemblies and the reference and transferred annotations are checked against their recorded checksums before a view opens, and a view whose file changed is refused.

## Reference genome view

The reference view shows the reference assembly that the annotation was transferred from, with two rows of tracks: the DNA sequence at the top, and below it the reference annotation, the source of every transferred gene.

**The long bar across the whole sequence.** An annotation downloaded from NCBI starts each chromosome or contig with a `region` record. It is drawn as one bar from the first to the last base, labelled with the sequence's name or number, and clicking anywhere on it shows the sequence's general metadata, such as the strain, the collection date, and where the sample was collected. It is not a gene. It is shown by default; to hide it, open Settings, choose the reference annotation, and switch off Show `region` records. A local reference annotation may have no such record.

**Genes in two rows.** The genes below the bar may take two rows, the second holding fewer genes, mostly on the reverse strand. Both rows are one annotation track: a gene moves to a second row only where it overlaps its neighbour, so that neither hides the other. In compact genomes such as fungi, neighbouring genes on opposite strands often share their ends; a gene on the forward strand followed by one on the reverse strand is the most common case, and the later of the two moves down. The row carries no meaning. Choose the collapsed layout in Settings to draw the track in one row, with overlapping genes on top of each other.

Use the reference view to see a gene as it was before the transfer: its exons, its coding sequence, and its attributes in the click details. Then find the same gene in the target view at its target position; see *Finding a gene* below.

## Target genome view

A **model** is a proposed structure for one copy of a gene at one place in the genome: where its exons lie, which part of them codes for protein, and so which protein the gene makes. It is a prediction from evidence, not an observation. In the browser, one model is one drawn transcript, with boxes for exons, thin lines for introns, and thick parts for the coding sequence; in a GFF3 file it is an `mRNA` record with its `exon` and `CDS` records. For one gene, the target view can show up to three models at the same place: Liftoff's suggestion, miniprot's suggestion, and LiftOn's final choice. When they agree, the transfer was straightforward; when they differ, the transferred model shows which suggestion LiftOn chose.

The target view shows the target assembly with three annotations below the DNA sequence. All three are GFF3 files of the same kind, holding gene models; they differ in which program made them and in their role. Each track's label says both:

| Track | File | What it holds | Shown on opening |
|---|---|---|---|
| Transferred annotation · GFF3 · LiftOn result | `results/annotation/lifton.raw.gff3` | LiftOn's final result, the annotation this run produced: one model per gene copy. | yes |
| Liftoff annotation · GFF3 · LiftOn intermediate | `lifton_output/liftoff/liftoff.gff3` | LiftOn's first step: Liftoff lifts each reference gene by its DNA sequence, one model per gene where the gene was placed. | no |
| miniprot annotation · GFF3 · LiftOn intermediate | `lifton_output/miniprot/miniprot.gff3` | LiftOn's second source: miniprot aligns each reference protein to the target. | no |

LiftOn starts from the Liftoff annotation and uses miniprot only to repair a protein or to add a missing gene; see *Transfer methods* above. The transferred annotation is therefore the Liftoff annotation for almost every gene: the two differ only where a transcript's `status` in the click details is not `Liftoff`, that is where LiftOn chained Liftoff and miniprot parts (`LiftOn_chaining_algorithm`), replaced the Liftoff model (`LiftOn_miniprot`), or added a gene from miniprot (`miniprot`). The transferred annotation also carries LiftOn's `protein_identity`, `dna_identity`, `mutation`, and `status`, which the Liftoff annotation lacks.

Both intermediate annotations therefore start hidden; switch them on in Tracks to compare a gene whose `status` is not `Liftoff` or whose protein changed. The miniprot annotation needs care: miniprot aligns every reference protein on its own to its best match anywhere in the target, without knowing where its gene lies. A protein whose own gene is missing or changed in the target therefore lands on a related gene's locus, even on another chromosome, and related proteins stack up there with different lengths and exons. LiftOn uses a miniprot model only together with the Liftoff model of the same transcript at the same place, or as a new gene where Liftoff placed none; the other miniprot models are not part of the result. At a gene, the miniprot model whose `Target` names that gene's own transcript is the one to compare.

Like the reference annotation, each track places overlapping genes in a second row; the rows are still one track. The target tracks have no `region` bar, because LiftOn does not transfer these records.

The intermediate files are part of LiftOn's output directory, whose checksum covers the directory as a whole; their tracks are therefore labelled *unverified*. An intermediate file missing from the run stays listed in Tracks with its problem.

Zoom in on a gene until the exons show their amino acids. Each model draws its start codon and its stop codon as marks inside its exons:

- **Same exons in the transferred, Liftoff, and miniprot models**: the transfer kept the reference structure, as for most genes.
- **A stop mark well before the end of the gene**: a premature stop codon truncates the protein (`stop_codon_gain`).
- **No stop mark at the end**: the protein has no stop codon (`stop_missing`).
- **A frameshift**: switch on the three-frame translation of the reference sequence in the display settings. After an insertion or deletion whose length is not a multiple of three, the coding sequence continues in another of the three frames. A model that keeps the old frame soon meets a stop codon there; a model with a short extra intron or gap at that place has stepped around the shift to stay in frame.
- **Exons that differ between the miniprot and the Liftoff model**: the two methods disagree about the gene structure here. miniprot follows the protein and may place a different splice site or skip a short exon; Liftoff follows the DNA of the whole gene. The transferred model shows which one LiftOn chose.

Click a transferred transcript to see LiftOn's attributes:

| Attribute | Meaning |
|---|---|
| `protein_identity` | The share of identical aligned amino acids between the transferred and the reference protein; 1.000 is identical. |
| `dna_identity` | The share of identical aligned bases between the transferred and the reference transcript. |
| `mutation` | The transcript's mutation classes, separated by commas; see *Mutation classes* above. |
| `status` | How LiftOn obtained the transcript; see *Transfer methods* above. |

A miniprot model is the alignment of one reference protein to the target. miniprot does not know genes, so it numbers its models in the order it finds them, such as `MP000001`, and the browser labels them by that ID. Click a model to see which protein it aligned and how well:

| Attribute | Meaning |
|---|---|
| `Target` | The aligned reference protein and the part of it covered, as `<protein> <first> <last>`: amino-acid positions, counted from 1 with both ends included. The protein is named by its reference transcript's ID, the same ID as in the other tracks. LiftOn's reference proteins end with the stop sign `*`, so a protein of 440 positions has 439 amino acids and its stop. `1 440` on such a protein means the whole protein aligned, its stop included; a range that starts after 1 or ends before the protein's length means part of it found no match here. On a CDS, the range is the part of the protein that this exon encodes; consecutive exons continue each other's range, and a gap between them marks residues that did not align. |
| `Identity` | The share of identical amino acids in the aligned part, from 0 to 1. Unaligned parts of the protein are not counted, so read it together with the `Target` range. |
| `Positive` | The share of amino acids that are identical or similar in their chemistry; at least as high as `Identity`. |
| `StopCodon` | How many stop codons lie inside the alignment. Because the reference protein ends with its stop, a complete model normally has 1: the regular end. More than 1 means a premature stop codon in the target; on a CDS it marks the exon that contains a stop. |
| `Frameshift` | How many frameshifts miniprot placed to keep the protein aligned: an insertion or deletion whose length is not a multiple of three. Absent when there is none. |
| `Donor`, `Acceptor` | A splice site that is not the usual `GT` at the start or `AG` at the end of an intron, with the two bases found instead, such as `GC`. Some such sites are real minor splice sites; they are also a place to check for an alignment artefact. |
| `Rank` | 1 for this protein's best alignment in the target, 2 and higher for further alignments elsewhere, such as the copy of a duplicated gene or a related gene. |

## Finding a gene

The Region field accepts positions, not names. To find a gene, look up its position in the per-feature transfer table (see *Generated reports* above): it lists each reference feature with its target coordinates. Enter the target position in the target view, or the reference position, from the reference annotation, in the reference view. A transferred transcript keeps its reference ID, so it carries the same `ID` in the click details of both views; an additional copy adds a suffix such as `_1`.

To compare a gene with an additional copy, enter both positions separated by a space; the target view shows them side by side.
