# Annotation review

## Goal

Help a researcher find and settle the transferred genes that need a closer look. The annotation transfer rates every coding gene by how well its protein survived the transfer and lists the genes to review with their reasons. The browser's genome view shows each one with its evidence, following the CLI's list, and the researcher records a verdict per gene, or picks one of LiftOn's alternative models, in a decision saved in the CLI. A rule turns the decision into a reviewed GFF3; LiftOn's output stays unchanged.

This is the first step of [Manual annotation review and correction](../later.md#manual-annotation-review-and-correction): it keeps every provenance requirement listed there but edits no gene structure itself.

## Why proteins

A transfer only moves coordinates. The protein comparison tells whether a copied gene model still describes an intact protein in the target, which DNA identity cannot: many synonymous changes leave the protein unchanged, while one base can shift its reading frame. Researchers read it as three kinds of evidence:

1. **Transfer quality**: a gene placed at the wrong locus, such as a related gene of the same family, or only partly aligned, shows a low identity or no protein.
2. **Biology**: a disrupted, changed, or missing protein in the target strain, such as a loss-of-function candidate that explains a trait.
3. **Gene model**: LiftOn keeps the reference's gene structure. When a change in the target moved a splice site, start, or stop, the predicted protein looks broken although the gene may be fine; the model needs curation.

Identity is not function: one substitution in an active site can matter more than many conservative ones. The rating ranks genes for review; it does not predict their effect. "Changed" means different from the reference, not wrong.

### Curation

Curation is a person checking a flagged gene model against evidence and deciding what is true. The researcher looks at the locus in a genome browser, at the reference protein aligned to the target and at any other evidence, and then:

- **confirms** the model, because the change is real (for example a confirmed frameshift: the gene is a pseudogene in this strain);
- **corrects** it: another exon boundary, start, or stop, or split or merged models;
- **rejects** the gene as a misplacement or an artifact of the data.

The decision and its evidence are recorded, and a curated GFF3 is written next to the unmodified LiftOn output. GenoPilot supports confirming, rejecting, and correcting by choosing a model LiftOn already built; drawing a new structure stays in specialist editors ([Deferred](#deferred)).

## Rating

No new tool or alignment is needed. LiftOn already translates every transferred coding transcript, aligns it to the reference protein with parasail, and writes `protein_identity`, its mutation classes, and the transcript `status` into the raw GFF3. Our summary step (`summarize_annotation_transfer` with `collect_transfer_metrics.py`) already copies them into `results/feature-transfer.tsv`, one row per reference feature and target copy, with its mapping `status` (primary, additional copy, or unmapped), `transfer_method`, `minimum_protein_identity` over the feature's transcripts, and `mutations`. The script already reads LiftOn's transcript `status` from the raw GFF3, which the *model rebuilt* reason needs. The rating extends that step rather than adding a rule: it reads the target FASTA as well, adds four columns to the same table, and writes one BED.

The rating stays a workflow output, not a CLI calculation, so a direct Snakemake run produces it, the saved decision can name its checksum, and the application only displays it.

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
| unchanged | `identical`, `synonymous` |

Categories come from mutation classes rather than identity bands, because a frameshift near the end of a protein can still score a high identity.

### Unresolved bases

The summary step reads the target FASTA and counts, per gene, the bases that are not A, C, G, or T in the union of its transcripts' CDS, each position once: `N` from gaps or uncallable regions, and IUPAC codes from unresolved positions. A codon with such a base translates to `X` and lowers the identity, or breaks the frame, without any real change. Such genes get the flag `unresolved bases` and a count, so the researcher sees that the finding may be an artifact of the data. The same pass writes the target's unresolved intervals as a BED: the evidence behind the counts, checksummed with the run and readable in any genome browser, which the review view shows as a track rather than computing it again. This needs no knowledge of how the target was made and works for every target.

Input validation also counts the target's bases that are not A, C, G, or T, and reports them as a warning on the overview before the transfer runs.

### Review reasons

A gene is listed for review with one or more reasons:

| Reason | When |
|---|---|
| unmapped or lost | No target copy, or no protein could be aligned. |
| disrupted | Category `disrupted`: a frameshift, premature stop, missing stop, or lost start. |
| model rebuilt | LiftOn replaced or combined the direct DNA lift to get a closer protein (status `LiftOn_chaining_algorithm` or `LiftOn_miniprot`), or placed the gene by miniprot only: the target's gene structure likely differs from the reference's. |
| below threshold | Protein identity below the minimum protein identity, a run parameter in percent. |
| unresolved bases | The CDS contains bases that are not A, C, G, or T. |

The *Proteins* tab lists the rows with at least one reason, sorted so likely real changes come first: genes flagged disrupted, lost, or rebuilt without unresolved bases, then the rest by identity. Filtering and sorting is presentation; every value comes from the table. The threshold is a parameter of the summary step, so changing it reruns only that step and reuses LiftOn's results. Its default ships as 95%, provisional until the kickoff confirms it.

### Outputs

- `results/feature-transfer.tsv` gains `protein_category`, `lifton_status` (LiftOn's transcript statuses, comma-separated, which `transfer_method` shows only when the GFF3 `source` is missing), `unresolved_bases` (the count in the CDS), and `review_reasons` (comma-separated, empty when none). The threshold and the counts per category and per reason go into `results/metrics.json` with their definitions, as the existing metrics do.
- `results/target-unresolved.bed`: the target's intervals of bases that are not A, C, G, or T, linked from `results/summary.json`.
- A *Proteins* result tab: the threshold, the count per category, the count per review reason, and the review list with its reasons and, once reviewed, its verdicts. Documented in the workflow's `results.md`, including what each reason suggests to check.

## Review view

It builds on the target view of the [transfer genome views](transfer-genome-view.md); this section is revised against that design when the review is worked on.

The read-only genome view, built like the reference consensus's Sites view, which already provides everything the review needs: verified references, annotation and BED tracks served by Range, item markers drawn in memory, item cards, presets, a guide section from `results.md`, and navigation synchronized with the CLI. The review adds a view builder, `src/workflows/annotation-transfer/views.ts`, and no change to the shared browser code.

`v` on the *Proteins* tab's review list opens the view at the selected gene, in the target genome's coordinates; `v` in the review form does the same. As with Sites, the browser's previous and next move the CLI's selection, and changing the list's filter or leaving it detaches navigation until `v` is pressed again. Opening the review form is such a change today: the result screen keys its genome session by its mode, so entering the form detaches the tab's navigation and `v` in the form reopens the view on the form's list. Keeping one session across both, so the browser follows the researcher from the tab into the form without a reopen, is a refinement for when the review form is built.

- **Reference**: the resolved target FASTA, verified against the checksum the run's provenance records before it is served, as the consensus views verify their backbone.
- **Items**: the listed genes in review order, each targeting its primary copy's span. The item card shows the same facts as the CLI's gene detail: reference and target IDs and coordinates, reasons, protein identity, category, mutation classes, LiftOn status (`lifton_status`), unresolved base count, and the latest saved verdict with its candidate and note.
- **Tracks**, in this order, all in the target's coordinates and the same for every gene, so items carry no per-item track list:

  | Track | File | Shown |
  |---|---|---|
  | transferred annotation | `results/annotation/lifton.raw.gff3` | yes |
  | miniprot models: the reference protein aligned to the target | from `lifton_output/miniprot/` | yes |
  | Liftoff models: the reference gene lifted by its DNA | from `lifton_output/liftoff/` | yes |
  | unresolved bases | `results/target-unresolved.bed` | yes |
  | reviewed annotation of the latest completed review run | `results/review/review-<n>/annotation.reviewed.gff3` | no; listed only once that run has finished |

  The three GFF3 tracks have no index and load whole, which suits fungal and bacterial genomes. Following the [genome design](done/browser-view/genome.md#content), an annotation too large to load whole is listed with its size and not shown by default; indexing waits for a real case.

  The miniprot track is the key evidence: it shows where and how the reference protein aligns to the target, independent of the reference's gene structure. The target FASTA, the transferred GFF3, and the BED are verified against their checksums in the run's `artifacts.yaml`, and the reviewed GFF3 against `provenance/review/review-<n>.json`. The candidate files are served unverified, as the Sites view serves alignments and variants: `artifacts.yaml` records `lifton_output/` as one directory checksum, and hashing the whole directory on every opening would grow with LiftOn's intermediates. The view's sources label them unverified; they are shown as evidence and never imported. A file missing from an older run is listed with its problem rather than hidden. The exact candidate file names are fixed in the kickoff ([open questions](#open-questions)).
- **Presets**: *Gene*, the gene with about 500 bases on each side, so neighboring genes show whether the locus belongs to a gene family or a rearranged region; and *Region*, about 10 kilobases, to see a cluster of flagged genes or a gap. Neither shows reads.
- **Guide**: a `## Proteins genome review` section in the workflow's `results.md`, offered from the page's help menu while the view is open, as the Sites guide is. It explains the tracks and presets and holds the checks below, written for researchers.
- **Click details**: LiftOn's attributes, such as `protein_identity`, `mutation`, and `status`, already appear as recorded attributes. The guide explains them; the general glossary in `docs/` stays tool-agnostic.

The view comes before the decision in the [work order](#work): it is useful on its own, and it is how the open questions about the review list and the candidate models get answered on a representative transfer.

### What the researcher checks

The browser shows evidence only; the verdict is set in the CLI's review form, which the view follows. Per review reason, with what the view already offers:

| Reason | What to look at | Points to |
|---|---|---|
| disrupted (frameshift or stop) | Zoom into the CDS: IGV translates the transferred model and marks start and stop codons, so a premature stop shows inside an exon. The reference's three-frame translation, in the display settings, shows which frame the sequence continues in after a frameshift. | a real change: *confirmed* |
| disrupted, on or next to an unresolved base | The unresolved-bases track marks an `N` or IUPAC code at or beside the break. | an artifact of the data: *rejected*, or resolve the target first, such as through a consensus iteration |
| model rebuilt | Compare the exons of the transferred, miniprot, and Liftoff models. Where miniprot follows the reference protein better, a splice site, start, or stop has moved in the target. | *corrected* with the fitting candidate, or *confirmed* |
| below threshold | The *Region* preset: does the gene sit among others of its family, so the copy may sit at the wrong member? | a misplacement: *rejected*; otherwise *confirmed* |
| unmapped or lost | Is there a gap at the expected place, and does the miniprot track place the reference protein anywhere nearby? | *needs correction*, or *confirmed* when the gene is absent in this strain |

Clicking a model shows LiftOn's recorded `protein_identity`, `mutation`, and `status` in the click details. These checks guide the researcher; they are never saved and decide nothing on their own.

### Implementation notes

- Model the builder on `consensusSitesView` in `src/workflows/reference-consensus/views.ts`: the same `GenomeView` shape from `src/browser/contract.ts`, a stable view ID from the run's configuration path and the listed genes, provenance sources for every file, and `verifyFileChecksum` from `src/browser/verified-file.ts` for the verified files listed under *Tracks*.
- Item IDs are stable per row, such as the reference gene ID with its copy number, so selecting the same gene again only moves the selection. Items carry `details` but no `target.tracks`, because the tracks do not change per gene.
- Extract the guide from `results.md` by its heading, as the Sites view does with `Sites genome review`.
- Presets use the existing `GenomePreset` fields: `padding` 500 and 10000, `reads: false`.
- Build opening, following, and detaching on `useGenomeSession` (`src/browser/use-genome-session.ts`), its `open` and `updateSelection`, as the Sites tab does. The Sites wiring itself is consensus-specific and inline in `src/ui/run-results-screen/screen.tsx`; keep the annotation-transfer wiring beside `annotation-transfer-results.tsx` instead of adding a second workflow's branch there, in line with the [workflow code layout](../later.md#workflow-code-layout) task.
- Fixture tests for the builder: the track order, a missing candidate file shown with its problem, a checksum mismatch refusing the reference, item cards from table rows, and the reviewed track appearing only once a review run has finished. Browser tests stay parked.

### Not in the browser

Verdict buttons wait for the browser's decision drafting ([deferred](#deferred)); the view changes no shared browser code.

The source annotation is in the reference genome's coordinates, so the transferred view cannot show it. The item card names the reference gene's ID and coordinates; when the reference is a catalogued accession, the researcher opens it from the accession catalog. A linked reference view is [deferred](#deferred).

A consensus run's isolate reads are aligned to its backbone, not to the consensus, so they cannot be tracks here. Following a gene to its locus in the consensus run's backbone view is [later](../later.md#annotation-transfer-from-a-consensus-result).

## Review decision

### Verdicts

Per gene on the review list, drafted and saved in the CLI's review form; the browser shows the evidence and the saved verdicts but drafts nothing ([deferred](#deferred)):

| Verdict | Meaning | Note |
|---|---|---|
| confirmed | The transferred model stands; a disruption is real, for example a pseudogene in this strain. | required |
| rejected | A misplacement or an artifact of the data; the gene is left out of the reviewed GFF3. | required |
| corrected | The gene is replaced by one of LiftOn's candidate models (see below). | optional |
| needs correction | The model is wrong, and none of LiftOn's candidates fits. | optional |

A gene without a verdict stays as transferred and is reported as not reviewed. Only genes on the review list take a verdict.

The list can change after a decision was saved, such as when a new threshold rewrites `feature-transfer.tsv`. The review form starts from the latest decision against the current table: verdicts of genes still listed are kept, newly listed genes have none, and genes no longer listed are shown as such with their verdicts, never dropped silently. Saving keeps or removes each of them as the researcher chooses, and the review rules apply only what the saved decision holds, so a decision whose table checksum no longer matches is reported as made on an earlier rating.

### Choosing a candidate model

LiftOn builds up to three structures per gene: the Liftoff model, lifted from the reference's DNA; the miniprot model, from the reference protein aligned to the target; and its own chained combination. It keeps one in its GFF3 and the others stay in its output directory. When the kept one is wrong but another fits the evidence, the researcher chooses that one: *corrected, use the miniprot model*. This is a choice among models that exist, like a vote, not an edit: no coordinate is typed in, and the chosen model is copied as LiftOn wrote it.

The reviewed GFF3 keeps the transferred gene's `ID` and the reference's attributes, and takes the exons and CDS from the chosen candidate. The candidate's identifiers are mapped to the transferred gene's, and the result passes the same structural validation as LiftOn's GFF3.

### Saved decision and outputs

A decision is saved as `decisions/review-<n>.yaml`, numbered from 1. Each one is complete, starting from the previous one in the review form, so the latest decision alone describes the review; earlier ones stay as history. It records, per gene, the verdict, the chosen candidate, the note, the reviewer, and the time, and it names the checksums of the raw LiftOn GFF3 and of the `feature-transfer.tsv` it was made on.

Snakemake writes the reviewed annotation by asking for its provenance record, as cohort iterations do. It reruns only the review rules and reuses everything else:

- `results/review/review-<n>/annotation.reviewed.gff3`: the transferred annotation with the verdicts applied: rejected genes left out, corrected genes replaced, and every reviewed gene marked with `genopilot_review=<verdict>`.
- `results/review/review-<n>/review.tsv`: every gene on the review list with its reasons, verdict, chosen candidate, and note.
- `results/review/review-<n>/validation.json`: the reviewed GFF3's structural validation, by the existing validation script.
- `provenance/review/review-<n>.json`: the decision's checksum, the inputs' checksums, and the outputs' checksums.

The raw LiftOn GFF3 and its output directory never change.

## Reference consensus

The cohort consensus is not annotated: the workflow transfers no annotation and keeps only the per-isolate FASTAs and chains. Rather than repeat the transfer inside it, its README and `results.md` suggest running the annotation transfer next, with:

- target: the iteration's `consensus.fasta` (`results/cohort/initial/` or `results/cohort/iteration-<n>/`);
- reference: the backbone and a GFF3 for it, either the same NCBI accession, whose annotation the transfer downloads, or the local backbone FASTA with a matching GFF3.

The consensus keeps the backbone's sequence names, but indels shift its coordinates, so a lift is needed rather than reusing the backbone's GFF3 directly.

The suggestion warns about unresolved positions: the overview's *Bases written as N* and *Bases written as IUPAC codes* count what the transfer will see as unresolved bases, and every such base inside a gene marks it for review. Resolving loci first, for example through an iteration, or raising coverage, gives a cleaner rating. The transfer's own input warning and the `unresolved bases` flag then name the affected genes.

The suggestion and warning live only in that workflow's documentation; shared code and `docs/` stay workflow-agnostic. A result-page action that prefills the transfer's configuration is a [later](../later.md#annotation-transfer-from-a-consensus-result) idea.

## Deferred

- **Verdict actions in the browser**: *Confirm*, *Reject*, and *Needs correction* on the item, and *Use this model for the gene* on a candidate track, drafting into the review instead of the CLI form. They wait for the browser's [decision drafting](browser-view-follow-up.md), which is held until researchers ask for it. When they come, the review draft moves from the review form into the result screen, which stays mounted while the view is open, as the [genome design](done/browser-view/genome.md#decision-drafting) describes for the cohort review.
- **Linked reference view**: the reviewed gene in the reference genome with its source GFF3, opened from the item card or the gene detail. Take it up when looking the gene up in the accession catalog proves too slow, and design how one screen offers two views under the one `v` key.
- **Importing a corrected model** for genes marked *needs correction*: the researcher fixes the gene in a specialist editor, such as Apollo, and GenoPilot imports its replacement GFF3, validates it, records its checksum as `imported`, and shows the difference ([later](../later.md#corrected-gene-model-import)). Take it up when a researcher needs a structure LiftOn did not build.
- **Typing a structure** in a CLI form, with CDS phases recalculated and validated: not planned; the import covers it.
- **Read evidence** for a consensus target, through the consensus run's backbone view.
- **Reviewing genes off the list**, such as an additional copy or an unchanged gene a researcher distrusts.

## Open questions

Answered in the kickoff (work step 6) with the review view on a representative same-species transfer:

- Which files hold the candidate models, and does IGV show them: answered by the [transfer genome views](transfer-genome-view.md#open-questions).
- Show unmapped genes in the reference view of the transfer genome views?
- Can each gene's Liftoff and miniprot models be matched to the transferred gene, by ID or locus, and which attributes does the reviewed GFF3 take from them? If they cannot be matched reliably, the candidate choice waits and *needs correction* covers those genes.
- Default threshold: confirm the provisional 95% or change it.
- Does the reasons table catch the genes a researcher would curate? Walk the review list in the view with a researcher; their feedback also counts as the [browser follow-up](browser-view-follow-up.md)'s requirements collection.

## Work

1. [ ] Count the target's bases that are not A, C, G, or T in input validation and warn about them.
2. [ ] Rating in the summary step: the threshold parameter, the target FASTA as input, the four new columns, the metrics, and the BED, with tests on synthetic FASTA and GFF3 rows for every category and reason, and for the empty columns on additional copies and non-coding features.
3. [ ] The *Proteins* result tab with its gene detail, documented in the annotation transfer's `README.md` and `results.md`.
4. [ ] Review view: the view builder with the verified target, the tracks, item cards, presets, and synchronized navigation from the review list, the `## Proteins genome review` guide section, and fixture tests for the builder (track order, missing candidate files, checksum mismatch, item cards).
5. [ ] The consensus suggestion with the warning about unresolved positions in the reference consensus's `README.md` and `results.md`.
6. [ ] Kickoff for the decision: answer the [open questions](#open-questions) with the review view.
7. [ ] Review decision: the review form with `v`, `decisions/review-<n>.yaml`, the review rules, the reviewed GFF3 and its validation, provenance, and the reviewed track and saved verdicts in the view, with tests for every verdict, a candidate replacement, an unchanged raw GFF3, and a decision made on an earlier rating.
