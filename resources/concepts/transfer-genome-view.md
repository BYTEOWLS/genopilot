# Transfer genome views

## Goal

Let a researcher look at what an annotation transfer did, on both genomes, in the browser's [genome view](done/browser-view/genome.md): the reference with its source annotation, and the target with the transferred annotation and LiftOn's candidate models. The views are read-only and work for any finished annotation-transfer run, without a rating or review.

The [annotation review](annotation-review.md) builds on the target view later and may revise this design when it is worked on.

## Opening

`v` on the result screen opens a two-row choice, *Target* or *Reference*, and the tab shows the chosen view. Each genome has its own coordinates, so they are two views; choosing the other one later replaces the tab's content, as the [container](done/browser-view/README.md#opening-from-the-cli) defines. Shared browser code does not change.

## Views

**Reference**: the resolved reference FASTA and GFF3 from `resolved/`, both verified against the run's `artifacts.yaml` before they are served. This covers a local reference as well as an accession; an accession can also be opened from the accession catalog.

**Target**: the resolved target FASTA, with these tracks in this order:

| Track | File | Verified |
|---|---|---|
| transferred annotation | `results/annotation/lifton.raw.gff3` | yes, against `artifacts.yaml` |
| miniprot models: the reference protein aligned to the target | from `lifton_output/miniprot/` | no |
| Liftoff models: the reference gene lifted by its DNA | from `lifton_output/liftoff/` | no |

`artifacts.yaml` records `lifton_output/` as one directory checksum, so the candidate files are served unverified and labelled so, as evidence. A file missing from an older run is listed with its problem rather than hidden. A large unindexed GFF3 follows the genome kind's existing [size rule](done/browser-view/genome.md#content).

### No gene items

The views have no items. Items mirror a list the CLI leads, and the result screen shows only counts today. Listing a useful subset of genes, such as changed proteins, is the annotation review's rating; listing every gene would only repeat the annotation track. The views are for browsing: zoom, the track chooser, and the locus field.

## Guide

A `## Transfer genome views` section in the workflow's `results.md`, offered from the page's help menu while a view is open, written for researchers:

- how to read the three target models: IGV's start and stop marks inside the exons, the three-frame translation that shows which frame the sequence continues in after a frameshift, and where the miniprot model's exons differ from the Liftoff model's;
- what LiftOn's `protein_identity`, `mutation`, and `status` in the click details mean, linking to the *Mutation classes* and *Transfer methods* tables on the same page;
- that a gene lies at different coordinates in the reference and the target;
- finding a gene by its ID in the locus field, if the [open question](#open-questions) confirms it works.

## Implementation notes

- Builders in `src/workflows/annotation-transfer/views.ts`, modelled on the accession view and `consensusSitesView` in `src/workflows/reference-consensus/views.ts`, verifying files with `verifyFileChecksum` from `src/browser/verified-file.ts`.
- The choice and the `useGenomeSession` wiring live beside `annotation-transfer-results.tsx`, not in `screen.tsx`.
- Fixture tests for the builders: track order, a missing candidate file shown with its problem, and a checksum mismatch refusing the view. Browser tests stay parked.

## Open questions

Answered with a real run:

- Which files in `lifton_output/liftoff/` and `lifton_output/miniprot/` hold the candidate models, and does IGV show them as gene models, translation included? A file it cannot show is a decision point, not a reason for a converted copy.
- Does the page's locus field, which calls igv.js `search()`, find gene IDs in the loaded GFF3 tracks? If not, that is a decision point, not a new feature.

## Work

1. [ ] Both views: the builders, the choice on `v`, the guide section in `results.md`, and fixture tests.
2. [ ] Answer the [open questions](#open-questions) on a representative run and record the candidate file names here.
