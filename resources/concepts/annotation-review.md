# Annotation review

## Goal

Help a researcher find and settle the transferred genes that need a closer look. The annotation transfer rates every coding gene by how well its protein survived the transfer and lists the genes to review with their reasons. A genome view shows each one with its evidence, and the researcher records a verdict per gene, or picks one of LiftOn's alternative models, in a saved decision. A rule turns the decision into a reviewed GFF3; LiftOn's output stays unchanged.

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

No new tool or alignment is needed. LiftOn already translates every transferred coding transcript, aligns it to the reference protein with parasail, and writes `protein_identity`, its mutation classes, and the transcript `status` into the raw GFF3. The rating is a new summary rule of the annotation transfer over these values, the target FASTA, and the existing per-feature transfer TSV.

### Unit

One row per coding reference gene, rated by its primary target copy, consistent with the existing count of coding reference features with a protein change or loss. A gene with several transcripts takes its worst transcript: the lowest protein identity and the most severe category. Additional copies stay in the per-feature transfer TSV and are not rated. Non-coding genes are not rated.

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

The rating reads the target FASTA and counts, per gene, the bases of its CDS that are not A, C, G, or T: `N` from gaps or uncallable regions, and IUPAC codes from unresolved positions. A codon with such a base translates to `X` and lowers the identity, or breaks the frame, without any real change. Such genes get the flag `unresolved bases` and a count, so the researcher sees that the finding may be an artifact of the data. The same pass writes the target's unresolved intervals as a BED for the genome view. This needs no knowledge of how the target was made and works for every target.

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

The list is sorted so likely real changes come first: genes flagged disrupted, lost, or rebuilt without unresolved bases, then the rest by identity. Changing the threshold reruns only the rating rule and reuses LiftOn's results.

### Outputs

- `results/protein-rating.tsv`: one row per coding reference gene with its target ID and coordinates, protein identity, category, mutation classes, LiftOn status, unresolved base count, and review reasons (empty when none).
- `results/protein-review.tsv`: the rows with at least one review reason, in review order.
- `results/target-unresolved.bed`: the target's intervals of bases that are not A, C, G, or T.
- A *Proteins* result tab: the threshold, the count per category, the count per review reason, and the review list with its reasons and, once reviewed, its verdicts. Documented in the workflow's `results.md`, including what each reason suggests to check.

## Review view

A [genome view](done/browser-view/genome.md#reviewing-a-transferred-gene) opened with `v` from the review list on the *Proteins* tab, in the target genome's coordinates:

- **Items**: the review list in its order; the item card shows the reasons, identity, category, mutation classes, LiftOn status, unresolved base count, and the draft's verdict.
- **Tracks**: the transferred GFF3, LiftOn's candidate models from its Liftoff and miniprot outputs in `lifton_output/`, and the unresolved-bases BED. The miniprot track is the key evidence: it shows where and how the reference protein aligns to the target, independent of the reference's gene structure.
- **Guide**: a *What to check* section in `results.md` per review reason, such as: does the frameshift lie next to an unresolved base; do the transferred and the miniprot models differ in their exons; does the gene sit among others of its family.

The source annotation is in the reference genome's coordinates, so it is a view of its own: the item card offers the gene in the reference view, which replaces the tab's content until `v` is pressed again on the review list.

A consensus run's isolate reads are aligned to its backbone, not to the consensus, so they cannot be tracks here. Following a gene to its locus in the consensus run's backbone view is [later](../later.md#annotation-transfer-from-a-consensus-result).

## Review decision

### Verdicts

Per gene on the review list, drafted in the CLI's review form or through the view's actions, and saved only in the CLI:

| Verdict | Meaning | Note |
|---|---|---|
| confirmed | The transferred model stands; a disruption is real, for example a pseudogene in this strain. | required |
| rejected | A misplacement or an artifact of the data; the gene is left out of the reviewed GFF3. | required |
| corrected | The gene is replaced by one of LiftOn's candidate models (see below). | optional |
| needs correction | The model is wrong, and none of LiftOn's candidates fits. | optional |

A gene without a verdict stays as transferred and is reported as not reviewed. Only genes on the review list take a verdict.

### Choosing a candidate model

LiftOn builds up to three structures per gene: the Liftoff model, lifted from the reference's DNA; the miniprot model, from the reference protein aligned to the target; and its own chained combination. It keeps one in its GFF3 and the others stay in its output directory. When the kept one is wrong but another fits the evidence, the researcher chooses that one: *corrected, use the miniprot model*. This is a choice among models that exist, like a vote, not an edit: no coordinate is typed in, and the chosen model is copied as LiftOn wrote it.

The reviewed GFF3 keeps the transferred gene's `ID` and the reference's attributes, and takes the exons and CDS from the chosen candidate. The candidate's identifiers are mapped to the transferred gene's, and the result passes the same structural validation as LiftOn's GFF3.

### Saved decision and outputs

A decision is saved as `decisions/review-<n>.yaml`, numbered from 1. Each one is complete, starting from the previous one in the review form, so the latest decision alone describes the review; earlier ones stay as history. It records, per gene, the verdict, the chosen candidate, the note, the reviewer, and the time, and it names the checksums of the raw LiftOn GFF3 and of the rating it was made on.

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

- **Importing a corrected model** for genes marked *needs correction*: the researcher fixes the gene in a specialist editor, such as Apollo, and GenoPilot imports its replacement GFF3, validates it, records its checksum as `imported`, and shows the difference ([later](../later.md#corrected-gene-model-import)). Take it up when a researcher needs a structure LiftOn did not build.
- **Typing a structure** in a CLI form, with CDS phases recalculated and validated: not planned; the import covers it.
- **Read evidence** for a consensus target, through the consensus run's backbone view.
- **Reviewing genes off the list**, such as an additional copy or an unchanged gene a researcher distrusts.

## Open questions

- Can each gene's Liftoff and miniprot models be matched in `lifton_output/`, by ID or locus, and which attributes does the reviewed GFF3 take from them? Check against the pinned LiftOn on a representative transfer; if they cannot be matched reliably, the candidate choice waits and *needs correction* covers those genes.
- Default threshold: confirm a value, such as 95%, against a representative same-species transfer.
- Does the reasons table catch the genes a researcher would curate? Check the review list of a representative transfer with a researcher before finishing the result tab.

## Work

1. [ ] Count the target's bases that are not A, C, G, or T in input validation and warn about them.
2. [ ] Rating: the threshold parameter, the rating rule and script with categories, unresolved bases, and review reasons, both TSVs and the BED, with tests on synthetic FASTA and GFF3 rows for every category and reason.
3. [ ] The *Proteins* result tab, documented in the annotation transfer's `README.md` and `results.md`.
4. [ ] The consensus suggestion with the warning about unresolved positions in the reference consensus's `README.md` and `results.md`.
5. [ ] Kickoff for the decision: answer the candidate-matching question.
6. [ ] Review decision: the review form, `decisions/review-<n>.yaml`, the review rules, the reviewed GFF3 and its validation, and provenance, with tests for every verdict, a candidate replacement, and an unchanged raw GFF3.
7. [ ] Review view, after the [browser view](done/browser-view/README.md)'s genome kind and decision drafting: the view builder, tracks, guide section, and the verdict actions.
