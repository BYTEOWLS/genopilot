# Annotation review

## Goal

Help a researcher find the transferred genes that need a closer look. The annotation transfer rates every coding gene by how well its protein survived the transfer and lists the genes to review with their reasons. The browser's genome view shows each one with its evidence, following the CLI's list.

Settling them, with a verdict per gene or a choice among LiftOn's candidate models saved as a decision, is the [annotation review decision](../annotation-review-decision.md). Both are steps of [Manual annotation review and correction](../../later.md#manual-annotation-review-and-correction).

## Why proteins

A transfer only moves coordinates. The protein comparison tells whether a copied gene model still describes an intact protein in the target, which DNA identity cannot: many synonymous changes leave the protein unchanged, while one base can shift its reading frame. Researchers read it as three kinds of evidence:

1. **Transfer quality**: a gene placed at the wrong locus, such as a related gene of the same family, or only partly aligned, shows a low identity or no protein.
2. **Biology**: a disrupted, changed, or missing protein in the target strain, such as a loss-of-function candidate that explains a trait.
3. **Gene model**: LiftOn keeps the reference's gene structure. When a change in the target moved a splice site, start, or stop, the predicted protein looks broken although the gene may be fine; the model needs curation.

Identity is not function: one substitution in an active site can matter more than many conservative ones. The rating ranks genes for review; it does not predict their effect. "Changed" means different from the reference, not wrong.

## Rating

No new tool or alignment is needed. LiftOn already translates every transferred coding transcript, aligns it to the reference protein with parasail, and writes `protein_identity`, its mutation classes, and the transcript `status` into the raw GFF3. Our summary step (`summarize_annotation_transfer` with `collect_transfer_metrics.py`) already copies them into `results/feature-transfer.tsv`, one row per reference feature and target copy, with its mapping `status` (primary, additional copy, or unmapped), `transfer_method`, `minimum_protein_identity` over the feature's transcripts, and `mutations`. The script already reads LiftOn's transcript `status` from the raw GFF3, which the `lifton_status` column records. The rating extends that step rather than adding a rule: it reads the target FASTA as well, adds eight columns to the same table (the four of the rating and the reference feature's position), and writes one BED.

The rating stays a workflow output, not a CLI calculation, so a direct Snakemake run produces it, a saved [decision](../annotation-review-decision.md) can name its checksum, and the application only displays it.

### Unit

The row of a coding reference gene's primary target copy, or its unmapped row, consistent with the existing count of coding reference features with a protein change or loss. A gene with several transcripts takes its worst transcript: the lowest protein identity, as the table already records, and the most severe category. Rows of additional copies and of non-coding features keep the new columns empty.

### Categories

From the primary copy's mutation classes, the most severe one wins:

| Category | Mutation classes |
|---|---|
| unmapped | no target copy |
| lost | `full_transcript_loss`, `no_protein` |
| disrupted | `frameshift`, `stop_codon_gain`, `stop_missing`, `start_lost` |
| in-frame indel | `inframe_insertion`, `inframe_deletion` |
| substitutions | `nonsynonymous` |
| unchanged | `identical`, `synonymous`, or no class |

Categories come from mutation classes rather than identity bands, because a frameshift near the end of a protein can still score a high identity. LiftOn writes no class at all for an identical transcript, so no class means unchanged; a mapped coding gene without any protein identity is lost. A class the table does not know fails the summary step rather than being placed silently.

### Unresolved bases

The summary step reads the target FASTA and counts, per gene, the bases that are not A, C, G, or T in the union of its transcripts' CDS, each position once: `N` from gaps or uncallable regions, and IUPAC codes from unresolved positions. A codon with such a base translates to `X` and lowers the identity, or breaks the frame, without any real change. Such genes get the flag `unresolved bases` and a count, so the researcher sees that the finding may be an artifact of the data. The same pass writes the target's unresolved intervals as a BED: the evidence behind the counts, checksummed with the run and readable in any genome browser, which the review view shows as a track rather than computing it again. This needs no knowledge of how the target was made and works for every target.

Input validation also counts the target's bases that are not A, C, G, or T and records a warning in its report before the transfer runs. The overview shows the summary step's count, split into `N` and other codes, from `metrics.json`.

### Review reasons

A gene is listed for review with one or more reasons:

| Reason | When |
|---|---|
| unmapped or lost | No target copy, or no protein could be aligned. |
| disrupted | Category `disrupted`: a frameshift, premature stop, missing stop, or lost start. |
| below threshold | Protein identity below the minimum protein identity, a run parameter in percent. |
| unresolved bases | The CDS contains bases that are not A, C, G, or T. |

LiftOn's transcript status (`lifton_status`) is recorded and shown for every rated gene but is not a reason ([Decisions](#decisions)).

The *Proteins* tab lists the rows with at least one reason, sorted so likely real changes come first: genes flagged disrupted, lost, or unmapped without unresolved bases, then the rest, each by identity. Filtering and sorting is presentation; every value comes from the table. The threshold is a parameter of the summary step, so changing it reruns only that step and reuses LiftOn's results. Its default is 99%. Protein identity is a fraction from 0 to 1, compared with the threshold divided by 100.

### Outputs

- `results/feature-transfer.tsv` gains `reference_seqid`, `reference_start`, `reference_end`, `reference_strand` (every feature's reference position), `protein_category`, `lifton_status` (LiftOn's transcript statuses, comma-separated, which `transfer_method` shows only when the GFF3 `source` is missing), `unresolved_bases` (the count in the CDS), and `review_reasons` (comma-separated, empty when none). The threshold and the counts per category and per reason go into `results/metrics.json` with their definitions, as the existing metrics do.
- `results/target-unresolved.bed`: the target's intervals of bases that are not A, C, G, or T, linked from `results/summary.json`.
- A *Proteins* result tab: a summary of exact matches (unchanged, not listed), near matches (changed but at or above the threshold, not listed), and genes that need review, as `genes_by_match` in `metrics.json`; the threshold, the count per category, the count per review reason, and the review list with its reasons. Documented in the workflow's `results.md`, including what each reason suggests to check.

## Review view

It builds on the target view of the [transfer genome views](transfer-genome-view.md).

The read-only genome view, built like the reference consensus's Sites view: verified references, annotation and BED tracks served by Range, item markers drawn in memory, item cards, presets, a guide section from `results.md`, and navigation synchronized with the CLI. The review adds a view builder, `src/workflows/annotation-transfer/views.ts`; the shared browser code gained only what every review view uses (see [Decisions](#decisions)).

On the *Proteins* tab `v` opens the view at the selected gene directly; on the other tabs it offers *Proteins* beside the transfer views' *Target* and *Reference* and opens the view at the tab's selected gene, in the target genome's coordinates. As with Sites, the browser's previous and next move the CLI's selection, and changing the list's filter detaches navigation until `v` is pressed again. The tab reads its list when the result opens, so the choice works from every tab.

- **Reference**: the resolved target FASTA, verified against the checksum the run's provenance records before it is served, as the consensus views verify their backbone.
- **Items**: the listed genes in review order, each targeting its primary copy's span; an unmapped gene has no target span and is not an item. The item card shows the same facts as the CLI's gene detail: reference and target IDs and coordinates, reasons, protein identity, category, mutation classes, LiftOn status (`lifton_status`), and unresolved base count.
- **Tracks**, in this order, all in the target's coordinates and the same for every gene, so items carry no per-item track list:

  | Track | File | Shown |
  |---|---|---|
  | transferred annotation | `results/annotation/lifton.raw.gff3` | yes |
  | Liftoff annotation: the reference gene lifted by its DNA | `lifton_output/liftoff/liftoff.gff3` | no |
  | miniprot annotation: the reference protein aligned to the target | `lifton_output/miniprot/miniprot.gff3` | no |
  | unresolved bases | `results/target-unresolved.bed` | yes |

  These are the target view's tracks, which gains the BED. The review view shows the Liftoff and miniprot annotations on opening, because they carry the reference gene's structure and protein into the target's coordinates, and adds items, presets, and its guide. A track the researcher shows or hides keeps that choice from one gene to the next.

  The three GFF3 tracks have no index and load whole, which suits fungal and bacterial genomes. Following the [genome design](browser-view/genome.md#content), an annotation too large to load whole is listed with its size and not shown by default; indexing waits for a real case.

  The miniprot track is the key evidence: it shows where and how the reference protein aligns to the target, independent of the reference's gene structure. The target FASTA, the transferred GFF3, and the BED are verified against their checksums in the run's `artifacts.yaml`. The candidate files are served unverified, as the Sites view serves alignments and variants: `artifacts.yaml` records `lifton_output/` as one directory checksum, and hashing the whole directory on every opening would grow with LiftOn's intermediates. The view's sources label them unverified; they are shown as evidence and never imported. A missing candidate file is listed with its problem rather than hidden. The candidate file names were fixed by the [transfer genome views](transfer-genome-view.md#open-questions).
- **Presets**: *Gene*, the gene with about 500 bases on each side, so neighboring genes show whether the locus belongs to a gene family or a rearranged region; and *Region*, about 10 kilobases, to see a cluster of flagged genes or a gap. Neither shows reads.
- **Guide**: a `## Proteins genome review` section in the workflow's `results.md`, directly before the transfer guide, so the review view's guide runs from it to the end of the page and brings the track explanations along. It explains the items and presets and holds the checks below, written for researchers.
- **Click details**: LiftOn's attributes, such as `protein_identity`, `mutation`, and `status`, already appear as recorded attributes. The guide explains them; the general glossary in `docs/` stays tool-agnostic.

The view is useful on its own, and it is how the [decision's](../annotation-review-decision.md) open questions about the review list and the candidate models get answered on a representative transfer.

### Implementation notes

- Model the builder on `consensusSitesView` in `src/workflows/reference-consensus/views.ts`: the same `GenomeView` shape from `src/browser/contract.ts`, a stable view ID from the run's configuration path and the listed genes, provenance sources for every file, and `verifyFileChecksum` from `src/browser/verified-file.ts` for the verified files listed under *Tracks*.
- Item IDs are stable per row: the reference gene ID, since only primary copies are rated, so selecting the same gene again only moves the selection. Items carry `details` but no `target.tracks`, because the tracks do not change per gene.
- Extract the guide from `results.md` by its heading, as the Sites view does with `Sites genome review`.
- Presets use the existing `GenomePreset` fields: `padding` 500 and 10000, `reads: false`.
- Build opening, following, and detaching on `useGenomeSession` (`src/browser/use-genome-session.ts`), its `open` and `updateSelection`, as the Sites tab does. The Sites wiring itself is consensus-specific and inline in `src/ui/run-results-screen/screen.tsx`; keep the annotation-transfer wiring beside `annotation-transfer-results.tsx` instead of adding a second workflow's branch there, in line with the [workflow code layout](../../later.md#workflow-code-layout) task.
- Fixture tests for the builder: the track order, a missing candidate file shown with its problem, a checksum mismatch refusing the reference, and item cards from table rows. Browser tests stay parked.

### Not in the browser

Verdicts are set in the CLI; verdict buttons in the browser are [deferred](../annotation-review-decision.md#deferred).

The source annotation is in the reference genome's coordinates, so the transferred view cannot show it. The item card names the reference gene's ID and coordinates, to open in the Reference view. A linked reference view is [deferred](../annotation-review-decision.md#deferred).

A consensus run's isolate reads are aligned to its backbone, not to the consensus, so they cannot be tracks here. Following a gene to its locus in the consensus run's backbone view is [later](../../later.md#annotation-transfer-from-a-consensus-result).

## Reference consensus

The cohort consensus is not annotated: the workflow transfers no annotation and keeps only the per-isolate FASTAs and chains. Rather than repeat the transfer inside it, its README and `results.md` suggest running the annotation transfer next, with:

- target: the iteration's `consensus.fasta` (`results/cohort/initial/` or `results/cohort/iteration-<n>/`);
- reference: the backbone and a GFF3 for it, either the same NCBI accession, whose annotation the transfer downloads, or the local backbone FASTA with a matching GFF3.

The consensus keeps the backbone's sequence names, but indels shift its coordinates, so a lift is needed rather than reusing the backbone's GFF3 directly.

The suggestion warns about unresolved positions: the overview's *Bases written as N* and *Bases written as IUPAC codes* count what the transfer will see as unresolved bases, and every such base inside a gene marks it for review. Resolving loci first, for example through an iteration, or raising coverage, gives a cleaner rating. The transfer's own input warning and the `unresolved bases` flag then name the affected genes.

The suggestion and warning live in that workflow's documentation and on its result page's Overview, which names the consensus FASTA, the backbone, and the unresolved bases once the active iteration's consensus exists; shared code and `docs/` stay workflow-agnostic. A result-page action that prefills the transfer's configuration is a [later](../../later.md#annotation-transfer-from-a-consensus-result) idea.

## Decisions

Taken at the kickoff of steps 1–4 on two local runs: a transfer between strains (10,453 coding genes) and a transfer onto a cohort consensus (222,426 `N` and 30 IUPAC codes).

- **Model rebuilt is information only.** As a reason it listed 326 of 365 genes on the transfer between strains, mostly at 99.5% identity or more with substitutions or in-frame indels only, where LiftOn's rebuild already worked. `lifton_status` stays a column, in the gene detail, and on the item card.
- **Default threshold 99%**, instead of the provisional 95%. Genes below it: 152 on the transfer between strains (95%: 116, 98%: 136), 27 on the consensus.
- **No mutation class means unchanged.** LiftOn writes no `identical`: 7,360 coding genes had no class and identity 1.0.
- **Unresolved bases are worth a reason.** On the consensus, 11 coding genes have unresolved bases in their CDS, and all 11 look changed.
- **Track order and visibility follow the transfer target view**, which superseded this concept's earlier table; the unresolved-bases BED joins it and is shown.
- **Reference context without a second genome**: the review view shows the Liftoff and miniprot annotations by default, `feature-transfer.tsv` records every feature's reference position (`reference_seqid`, `reference_start`, `reference_end`, `reference_strand`) for the gene detail and item card, and a click on a list marker shows the item's facts. A linked reference view stays [deferred](../annotation-review-decision.md#deferred).
- **Track choices last across items**: in a review view, a track shown or hidden by the researcher keeps that choice on the next and previous item, in every workflow's review views.
- **`v` opens the selected gene directly on the *Proteins* tab**, and offers *Proteins* as a third choice on the other tabs.

## Work

1. [x] Count the target's bases that are not A, C, G, or T in input validation and warn about them.
2. [x] Rating in the summary step: the threshold parameter, the target FASTA as input, the new columns, the metrics, and the BED, with tests on synthetic FASTA and GFF3 rows for every category and reason, and for the empty columns on additional copies and non-coding features.
3. [x] The *Proteins* result tab with its gene detail, documented in the annotation transfer's `README.md` and `results.md`.
4. [x] Review view: the view builder with the verified target, the tracks, item cards, presets, and synchronized navigation from the review list, the `## Proteins genome review` guide section, and fixture tests for the builder (track order, missing candidate files, checksum mismatch, item cards).
5. [x] The consensus suggestion with the warning about unresolved positions in the reference consensus's `README.md` and `results.md`, and on its result page's Overview.

The verdicts, the candidate-model choice, and the reviewed GFF3 continue in the [annotation review decision](../annotation-review-decision.md).
