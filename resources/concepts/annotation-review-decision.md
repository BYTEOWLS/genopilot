# Annotation review decision

## Goal

Let a researcher settle the genes the [annotation review](done/annotation-review.md) lists: record a verdict per gene, or pick one of LiftOn's candidate models, in a decision saved in the CLI. A rule turns the decision into a reviewed GFF3; LiftOn's output stays unchanged.

This continues [Manual annotation review and correction](../later.md#manual-annotation-review-and-correction): it keeps every provenance requirement listed there but edits no gene structure itself.

## Curation

Curation is a person checking a flagged gene model against evidence and deciding what is true. The researcher looks at the locus in a genome browser, at the reference protein aligned to the target and at any other evidence, and then:

- **confirms** the model, because the change is real (for example a confirmed frameshift: the gene is a pseudogene in this strain);
- **corrects** it: another exon boundary, start, or stop, or split or merged models;
- **rejects** the gene as a misplacement or an artifact of the data.

The decision and its evidence are recorded, and a curated GFF3 is written next to the unmodified LiftOn output. GenoPilot supports confirming, rejecting, and correcting by choosing a model LiftOn already built; drawing a new structure stays in specialist editors ([Deferred](#deferred)).

## What the researcher checks

The browser shows evidence only; the verdict is set in the CLI's review form, which the view follows. Per review reason, with what the [review view](done/annotation-review.md#review-view) already offers:

| Reason | What to look at | Points to |
|---|---|---|
| disrupted (frameshift or stop) | Zoom into the CDS: IGV translates the transferred model and marks start and stop codons, so a premature stop shows inside an exon. The reference's three-frame translation, in the display settings, shows which frame the sequence continues in after a frameshift. | a real change: *confirmed* |
| disrupted, on or next to an unresolved base | The unresolved-bases track marks an `N` or IUPAC code at or beside the break. | an artifact of the data: *rejected*, or resolve the target first, such as through a consensus iteration |
| LiftOn status not `Liftoff` (information, not a reason) | Compare the exons of the transferred, miniprot, and Liftoff models. Where miniprot follows the reference protein better, a splice site, start, or stop has moved in the target. | *corrected* with the fitting candidate, or *confirmed* |
| below threshold | The *Region* preset: does the gene sit among others of its family, so the copy may sit at the wrong member? | a misplacement: *rejected*; otherwise *confirmed* |
| unmapped or lost | Is there a gap at the expected place, and does the miniprot track place the reference protein anywhere nearby? | *needs correction*, or *confirmed* when the gene is absent in this strain |

Clicking a model shows LiftOn's recorded `protein_identity`, `mutation`, and `status` in the click details. These checks guide the researcher; they are never saved and decide nothing on their own.

## Verdicts

Per gene on the review list, drafted and saved in the CLI's review form; the browser shows the evidence and the saved verdicts but drafts nothing ([deferred](#deferred)):

| Verdict | Meaning | Note |
|---|---|---|
| confirmed | The transferred model stands; a disruption is real, for example a pseudogene in this strain. | required |
| rejected | A misplacement or an artifact of the data; the gene is left out of the reviewed GFF3. | required |
| corrected | The gene is replaced by one of LiftOn's candidate models (see below). | optional |
| needs correction | The model is wrong, and none of LiftOn's candidates fits. | optional |

A gene without a verdict stays as transferred and is reported as not reviewed. Only genes on the review list take a verdict.

The list can change after a decision was saved, such as when a new threshold rewrites `feature-transfer.tsv`. The review form starts from the latest decision against the current table: verdicts of genes still listed are kept, newly listed genes have none, and genes no longer listed are shown as such with their verdicts, never dropped silently. Saving keeps or removes each of them as the researcher chooses, and the review rules apply only what the saved decision holds, so a decision whose table checksum no longer matches is reported as made on an earlier rating.

## Choosing a candidate model

LiftOn builds up to three structures per gene: the Liftoff model, lifted from the reference's DNA; the miniprot model, from the reference protein aligned to the target; and its own chained combination. It keeps one in its GFF3 and the others stay in its output directory. When the kept one is wrong but another fits the evidence, the researcher chooses that one: *corrected, use the miniprot model*. This is a choice among models that exist, like a vote, not an edit: no coordinate is typed in, and the chosen model is copied as LiftOn wrote it.

The reviewed GFF3 keeps the transferred gene's `ID` and the reference's attributes, and takes the exons and CDS from the chosen candidate. The candidate's identifiers are mapped to the transferred gene's, and the result passes the same structural validation as LiftOn's GFF3.

## Saved decision and outputs

A decision is saved as `decisions/review-<n>.yaml`, numbered from 1. Each one is complete, starting from the previous one in the review form, so the latest decision alone describes the review; earlier ones stay as history. It records, per gene, the verdict, the chosen candidate, the note, the reviewer, and the time, and it names the checksums of the raw LiftOn GFF3 and of the `feature-transfer.tsv` it was made on.

Snakemake writes the reviewed annotation by asking for its provenance record, as cohort iterations do. It reruns only the review rules and reuses everything else:

- `results/review/review-<n>/annotation.reviewed.gff3`: the transferred annotation with the verdicts applied: rejected genes left out, corrected genes replaced, and every reviewed gene marked with `genopilot_review=<verdict>`.
- `results/review/review-<n>/review.tsv`: every gene on the review list with its reasons, verdict, chosen candidate, and note.
- `results/review/review-<n>/validation.json`: the reviewed GFF3's structural validation, by the existing validation script.
- `provenance/review/review-<n>.json`: the decision's checksum, the inputs' checksums, and the outputs' checksums.

The raw LiftOn GFF3 and its output directory never change.

## Review view

The decision extends the [review view](done/annotation-review.md#review-view):

- **`v` in the review form** opens the view at the form's selected gene, as `v` on the *Proteins* tab does. The result screen keys its genome session by its mode, so entering the form detaches the tab's navigation and `v` in the form reopens the view on the form's list. Keeping one session across both, so the browser follows the researcher from the tab into the form without a reopen, is a refinement for when the form is built.
- **Reviewed track**: the reviewed annotation of the latest completed review run, `results/review/review-<n>/annotation.reviewed.gff3`, after the target view's tracks, hidden on opening and listed only once that run has finished. It is verified against `provenance/review/review-<n>.json`.
- **Item card**: the latest saved verdict with its candidate and note, beside the gene's facts.

## Deferred

- **Verdict actions in the browser**: *Confirm*, *Reject*, and *Needs correction* on the item, and *Use this model for the gene* on a candidate track, drafting into the review instead of the CLI form. They wait for the browser's [decision drafting](browser-view-follow-up.md), which is held until researchers ask for it. When they come, the review draft moves from the review form into the result screen, which stays mounted while the view is open, as the [genome design](done/browser-view/genome.md#decision-drafting) describes for the cohort review.
- **Linked reference view**: the reviewed gene in the reference genome with its source GFF3, opened from the item card or the gene detail. Take it up when looking the gene up by its reference position in the Reference view proves too slow, and design how one screen offers two views under the one `v` key.
- **Importing a corrected model** for genes marked *needs correction*: the researcher fixes the gene in a specialist editor, such as Apollo, and GenoPilot imports its replacement GFF3, validates it, records its checksum as `imported`, and shows the difference ([later](../later.md#corrected-gene-model-import)). Take it up when a researcher needs a structure LiftOn did not build.
- **Typing a structure** in a CLI form, with CDS phases recalculated and validated: not planned; the import covers it.
- **Read evidence** for a consensus target, through the consensus run's backbone view.
- **Reviewing genes off the list**, such as an additional copy or an unchanged gene a researcher distrusts.

## Open questions

Answered in the kickoff with the review view on a representative same-species transfer:

- Show unmapped genes in the reference view of the transfer genome views?
- Can each gene's Liftoff and miniprot models be matched to the transferred gene, by ID or locus, and which attributes does the reviewed GFF3 take from them? If they cannot be matched reliably, the candidate choice waits and *needs correction* covers those genes.
- Does the reasons table catch the genes a researcher would curate? Walk the review list in the view with a researcher; their feedback also counts as the [browser follow-up](browser-view-follow-up.md)'s requirements collection.

## Work

1. [ ] Kickoff: answer the [open questions](#open-questions) with the review view on a new representative transfer.
2. [ ] Review decision: the review form with `v`, `decisions/review-<n>.yaml`, the review rules, the reviewed GFF3 and its validation, provenance, and the reviewed track and saved verdicts in the view, with tests for every verdict, a candidate replacement, an unchanged raw GFF3, and a decision made on an earlier rating.
