# Transfer genome views

## Goal

Let a researcher look at what an annotation transfer did, on both genomes, in the browser's [genome view](browser-view/genome.md): the reference with its source annotation, and the target with the transferred annotation and LiftOn's candidate models. The views are read-only and work for any finished annotation-transfer run, without a rating or review.

The [annotation review](annotation-review.md) builds on the target view.

## Opening

`v` on the result screen opens a two-row choice, *Target* or *Reference*, and the tab shows the chosen view. Each genome has its own coordinates, so they are two views; choosing the other one later replaces the tab's content, as the [container](browser-view/README.md#opening-from-the-cli) defines. The views need no change to shared browser code; the general improvements made while building them (record-type switches, headlines naming the origin, the grouped help menu, track sizing and panning) are recorded in the [genome view](browser-view/genome.md) design and the changelog.

## Views

**Reference**: the resolved reference FASTA and GFF3 from `resolved/`, both verified against the run's `artifacts.yaml` before they are served. This covers a local reference as well as an accession; an accession can also be opened from the accession catalog.

**Target**: the resolved target FASTA, with these tracks in this order:

| Track | File | Verified |
|---|---|---|
| transferred annotation: LiftOn's result | `results/annotation/lifton.raw.gff3` | yes, against `artifacts.yaml` |
| Liftoff annotation: the reference gene lifted by its DNA, LiftOn's first step | from `lifton_output/liftoff/` | no |
| miniprot annotation: the reference protein aligned to the target | from `lifton_output/miniprot/` | no |

`artifacts.yaml` records `lifton_output/` as one directory checksum, so the candidate files are served unverified and labelled so, as evidence. A file missing from an older run is listed with its problem rather than hidden. A large unindexed GFF3 follows the genome kind's existing [size rule](browser-view/genome.md#content).

### No gene items

The views have no items. Items mirror a list the CLI leads, and the result screen shows only counts today. Listing a useful subset of genes, such as changed proteins, is the annotation review's rating; listing every gene would only repeat the annotation track. The views are for browsing: zoom, the track chooser, and the locus field.

## Guide

The closing `##` sections of the workflow's `results.md`, from `## Transfer genome views` (an introduction) through *Reference genome view*, *Target genome view*, and *Finding a gene* to the end of the page, offered from the page's help menu while a view is open with each section in the guide's submenu, written for researchers:

- how to read the three target models: IGV's start and stop marks inside the exons, the three-frame translation that shows which frame the sequence continues in after a frameshift, and where the miniprot model's exons differ from the Liftoff model's;
- what LiftOn's `protein_identity`, `mutation`, and `status` in the click details mean, linking to the *Mutation classes* and *Transfer methods* tables on the same page;
- that a gene lies at different coordinates in the reference and the target;
- finding a gene by its position from the per-feature transfer table, and comparing it with an additional copy side by side (see the [open questions](#open-questions)).

## Implementation notes

- Builders in `src/workflows/annotation-transfer/views.ts`, modelled on the accession view and `consensusSitesView` in `src/workflows/reference-consensus/views.ts`, verifying files with `verifyFileChecksum` from `src/browser/verified-file.ts`.
- The choice and the `useGenomeSession` wiring live beside `annotation-transfer-results.tsx`, not in `screen.tsx`.
- Fixture tests for the builders: track order, a missing candidate file shown with its problem, and a checksum mismatch refusing the view. Browser tests stay parked.

## Open questions

Answered at the kickoff with a representative run and by reading the pinned igv.js:

- **Candidate files**: `lifton_output/liftoff/liftoff.gff3` (gene, mRNA, exon, and CDS with the reference's IDs) and `lifton_output/miniprot/miniprot.gff3` (mRNA, CDS, and `stop_codon`; IDs such as `MP000001`, and `Target=` names the reference transcript). LiftOn also writes `*.gff3_db` databases beside them, which are not served. IGV shows both as gene models: for miniprot's CDS-only transcripts it assembles exons from the CDS, so the three-frame translation and start and stop marks work. On a fungal genome the Liftoff file is about 30 MB, below the size rule.
- **Gene IDs in the locus field**: igv.js would find a transcript's `ID` (not a gene's own ID, which it folds into the transcripts) in a loaded unindexed GFF3 track, but the page's Region field accepts only `sequence:start-end` regions and never passes a name to igv.js. An earlier answer here, taken from igv.js's code alone, missed that check. The guide therefore finds genes by their positions in the per-feature transfer table; searching by ID is a decision for the [annotation review](annotation-review.md), not this view. The field accepts several regions separated by spaces, which igv.js shows side by side.

## Decisions

Taken at the kickoff:

- **Verification**: the views read `artifacts.yaml` (JSON, valid YAML) by artifact path. A run without it, a file it does not record, or a checksum mismatch of any verified file (either FASTA, the reference GFF3, or the transferred GFF3) refuses the view with the reason; only the candidate files are served unverified.
- **Tracks**: in the table's order; only the transferred annotation is shown on opening. The Liftoff annotation equals the result for almost every gene (in the first real run, all but 21 chained transcripts and 5 added genes), and the miniprot annotation places every reference protein at its best match anywhere, including relatives' loci LiftOn never uses, so both intermediates start hidden in the track chooser; the size rule still turns off a large one. A missing intermediate file gets the problem *not found* from the builder and stays listed.
- **Provenance**: each verified source is labelled with its `artifacts.yaml` origin (`imported` or `generated`) and checksum; the candidate files are labelled *unverified*.
- **Track labels**: every track is named as a GFF3 annotation with its maker and role, such as *Liftoff annotation · GFF3 · LiftOn intermediate, unverified*; an earlier draft called the intermediates *models*, which read as a different kind of file. The word *model* stays for one drawn transcript.
- **Names**: the reference or target accession when the input came from NCBI, otherwise *Reference* or *Target*.
- **Choice**: a hook in its own file beside `annotation-transfer-results.tsx` owns the two-row choice and its genome session; `screen.tsx` only calls it, routes keys to it first, and shows its rows and shortcuts. Tab switching pauses while the choice is open.
- **Tests**: fixture tests for the builders only. The choice needs the browser provider, so its CLI test would be a browser-specific case, which stays parked.

## Work

1. [x] Both views: the builders, the choice on `v`, the guide section in `results.md`, and fixture tests.
2. [x] Answer the [open questions](#open-questions) on a representative run and record the candidate file names here.
3. [x] Check both views by eye in the browser: the three target tracks, translation and start and stop marks on the intermediate annotations, the guide in the help menu, and several regions side by side.
