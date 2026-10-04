# Genome view

The `genome` kind of the [browser view](README.md): any genome GenoPilot knows, together with the evidence lying next to it, shown with [igv.js](https://github.com/igvteam/igv.js). The container provides the tab, navigation, guidance, drafting, downloads, and the server; this document covers what is particular to genomes.

The first users are the review of unresolved consensus loci and the accession catalog. The researcher-facing background for the review is in [`science-background.md`](science-background.md). The genome view also shows the evidence for the [annotation review](../annotation-review.md) of transferred genes.

## Content

One reference and the tracks in its coordinates:

```ts
type GenomeContent = {
  kind: 'genome';
  reference: {name: string; fasta: string; index?: string};
  tracks: GenomeTrack[];
  /** Named track settings offered as one selector; the first is applied on opening. */
  presets?: GenomePreset[];
};
type GenomeTrack = {
  id: string;
  name: string;
  kind: 'alignment' | 'variant' | 'annotation';
  file: string;
  index?: string;
  /** Tracks sharing a group are listed and toggled together, such as one isolate's files. */
  group?: string;
  /** Loaded when the tab opens; the rest are listed in the page's track chooser. */
  shown: boolean;
};
type GenomePreset = {
  id: string;
  label: string;
  /** Which tracks are shown, in which order, and igv.js display settings per track. */
  tracks: {id: string; settings?: Record<string, unknown>}[];
  /** Bases shown on each side of the item: about 50 to read single bases, thousands to see a region. */
  padding: number;
};
/** A view item's target in a genome: a locus, 1-based and inclusive. */
type GenomeTarget = {
  chrom: string;
  start: number;
  end: number;
  /**
   * The tracks this item needs in their order, when they differ from item to item, such as the
   * voters at one locus grouped by the allele they voted for. Applied on top of the preset.
   */
  tracks?: {id: string; shown: boolean}[];
};
```

The view's `items` are loci of interest, such as unresolved sites; the page also draws them as a track of their own. Moving to another item applies its `tracks`, so the page shows the reads that matter at each locus without the researcher choosing them. `settings` passes igv.js track options through as they are; the spike records which ones the first presets need, and the view builder's tests pin them.

The caller states every file's kind; the page never guesses from extensions.

| Kind | Formats | Index |
|---|---|---|
| reference | FASTA, plain | `.fai` when present; otherwise built in memory by one linear scan and cached by path, size, and modification time |
| alignment | BAM | `.bai` or `.csi`, required |
| variant | VCF, bgzip | `.tbi` or `.csi`; a small plain VCF loads whole |
| annotation | BED, GFF3 | none; loaded whole |

BCF is not supported by igv.js; a caller offers the VCF instead or leaves the file out. Unindexed annotation files load into the browser whole, which is fine for fungal and bacterial genomes but not for annotations of hundreds of megabytes; such a file is listed with its size and not shown by default. Indexing those is deferred until a real case needs it.

**Coordinates are the caller's responsibility.** Every track must be in the reference's coordinates: an isolate's own consensus FASTA is a different reference from the backbone its reads were aligned to, not a track on it. The page checks only that each track's sequence names appear in the reference, where the index makes that cheap, and marks a mismatching track rather than hiding it.

## Sources

Each source contributes a view builder; the list grows by convention, not by changing the container:

- **Accession catalog**: a verified cached copy's `genomic.fna` with its `genomic.gff` when present. The index is built in memory, so the checksummed cache stays untouched.
- **Isolate catalog**: saved sequences, once [saved isolate sequences](../saved-isolate-sequences.md) exist, each as its own reference.
- **Run results**: each workflow's result screen, through its view builder. Reference consensus: the backbone with every isolate's alignment, variants, and consensus mask, the cohort's unresolved loci as items, and the backbone's GFF3 when the backbone is a catalogued accession with a verified cached annotation; the cohort consensus as its own reference. Annotation transfer: its target genome with the transferred GFF3, LiftOn's candidate models, and the unresolved-bases BED, with the review list as items (see *Reviewing a transferred gene*); the source annotation is in the source genome's coordinates, so it is a view of its own rather than a track.

## Reviewing an unresolved locus

The first use, in detail. What a researcher reads from the view is in [`science-background.md`](science-background.md).

**Reference**: the backbone, the coordinates every alignment, call, and mask of the run is in.

**Tracks at a locus**, in this order, built by the view builder from the Sites tables of the selected iteration:

| Who | Shown by default | On demand |
|---|---|---|
| the loci track and, when available, the backbone's annotation | yes | |
| each voter at this locus, grouped by the allele it voted for, the backbone's allele first | reads and variant row | consensus mask |
| each voting isolate that cast no vote here (ambiguous or uncallable), with its state | variant row and consensus mask | reads |
| every other isolate of the run, such as those excluded in this iteration | none | variant row and reads |

All voters are shown, on every side of the locus, because a tie is made by both sides. An ambiguous isolate's mixed reads are often the clearest evidence, so its reads are one click away. Showing reads only for the voters keeps the page fast with many isolates; the track chooser adds anything else.

**Zoom**: the view opens with the "Reads by allele" preset, about 50 bases on each side of the locus, so single bases and reads are readable; an indel's span widens it accordingly. The "Region" preset shows several kilobases with the loci track, which tells a single disagreement from a cluster of unresolved loci in a repeat or structural variant.

**What the review can change**: a cohort decision excludes isolates or changes the cohort settings, then reruns; it does not choose the allele at one locus. The evidence therefore leads to one of these:

| The evidence shows | What the researcher can do |
|---|---|
| one side's votes are weak or artefacts, and the same isolate is involved at many loci | exclude that isolate in the next iteration |
| the backbone's vote makes the tie and looks like an assembly error | switch the backbone vote off |
| a real split, or a repeat region | nothing: `N` or the IUPAC code is the honest result |
| one isolate's call is wrong at this locus only | not possible; see [Deferred](#deferred) |

### Deferred

Two extensions came up while designing this review and wait for researchers' requirements in [later.md](../../later.md#per-vote-evidence-and-per-locus-overrides): **per-vote evidence**, each voter's depth and allele fraction at the locus as numbers in the item card and the CLI's Sites detail, and a **per-locus override**, choosing the allele at one locus in a cohort decision. With an override, the genome view's drafting would gain a third action, *Choose this allele at this locus*.

## Reviewing a transferred gene

The second use, from the *Proteins* tab of an annotation transfer; the review list, its reasons, and the decision are in the [annotation review](../annotation-review.md) concept.

**Reference**: the target genome of the transfer.

**Tracks**, in this order:

| Track | Shown by default |
|---|---|
| the review list as the loci track | yes |
| the transferred GFF3 | yes |
| LiftOn's miniprot models: the reference protein aligned to the target | yes |
| LiftOn's Liftoff models: the reference gene lifted by its DNA | yes |
| the target's unresolved bases (BED) | yes |
| the reviewed GFF3 of the latest saved decision, when there is one | no |

**Zoom**: the gene with about 500 bases on each side, so neighboring genes show whether the locus is part of a gene family or a rearranged region.

**Reference view**: the item card offers the same gene in the reference genome with its source GFF3, as a view of its own; `v` on the review list returns to the review at the CLI's selected gene.

**Actions** (target: item): *Confirm* and *Reject* with a required note, *Needs correction* with an optional note. On the candidate tracks (target: track-group) *Use this model for the gene* drafts the verdict *corrected* with that candidate. All of them add to the result screen's review draft, as the cohort actions do.


On top of the container's navigation, the page uses igv.js's events (`locuschange`, `trackclick`, region selection, track menus):

- **Click a locus** in the loci track: selects that item.
- **Follow the view**: panning onto an item highlights it in the CLI; otherwise the CLI's status line shows the position.
- **Select a region**: the request `region`; the CLI lists the view's items inside it.
- **Track chooser**: every track of the view, grouped, with the ones not shown by default; choosing tracks is a page-only change and needs no CLI round trip.

### Decision drafting

Genome actions target an `item`, a `track-group`, or a `region`, offered in the loci track, a track group's menu, and a region selection. For the reference-consensus review, the first actions are:

- **Suggest excluding an isolate** (target: its track group; note optional): adds the isolate to the review draft's exclusions and appends the note, with the locus it was made at, to the draft's reason.
- **Note this locus** (target: item; note required): appends `<locus>: <note>` to the draft's reason.

Both fit the existing cohort decision without a schema change. Choosing the allele at a locus is [deferred](#deferred).

Today the review draft exists only inside the review form (`CohortReviewScreen`), which `r` opens as a mode of the result screen and which starts a fresh draft every time. While the researcher works on the Sites tab, where the view is opened from, there is no draft to add to. The draft therefore moves up into the result screen (`RunResultsScreen`), which stays mounted in every mode: browser actions add to it from any tab, the review form opens with it and edits it, and the CLI's status line counts what it holds. Cancelling the review form keeps the draft; saving the decision clears it, as does leaving the run's results, after the CLI asks whether to discard a non-empty draft.

## Page

What the genome kind adds to the container's [page](README.md#page):

- **Presets instead of track menus**: one selector in the header applies a named set of tracks and settings, such as "Votes" (compact variant rows of every isolate), "Reads by allele" (reads grouped by the base they carry at the locus), and "Region" (zoomed out with the loci track). A guide step's `show` button applies a preset, such as reads colored by strand or with low mapping quality emphasized. The track chooser stays for anything else.
- **Readable tracks**: tracks carry the names the CLI shows, such as an isolate's name with its vote and state, in the view's order, so a review lists the voters by allele and then those that cast no vote.
- **Less igv.js chrome**: genome selection, loading files from a URL or disk, and other controls that do not apply are hidden, so the page offers only what works.
- **Legend**: what igv.js draws and never explains: mismatch colors, faded reads for low mapping quality, insertion and deletion marks, coverage, soft clips. Probably the biggest help for researchers new to genome browsers.
- **States**: loading per track, a missing file with its path, and a track whose sequence names are not in the reference.
- **Downloads**: the current view as SVG and PNG, through igv.js's own export, with the container's provenance footer.

To confirm in the spike: the igv.js options for grouping reads by base at a position, coloring by strand, emphasizing mapping quality, compact variant rows, hiding its toolbar controls, and SVG export.

## Packaging

igv.js is MIT-licensed and is an exact-version development dependency, pinned to the latest evaluated release in `package.json`. The full npm package is fine in the development installation; no special extraction or copy of `igv.esm.min.js` is required for this integration.

Release packaging belongs to [Bundled package](../bundled-package.md). Its browser build will bundle the ESM imported by the genome renderer and load it only for genome views, carrying the used code and license notices rather than the whole npm distribution. A temporary esbuild check produced roughly 1.5 MB from the full development package, comparable to its published minified module; other module formats and source maps need not ship. The CLI and browser are separate execution environments, so one published npm package contains both the CLI bundle and browser assets, not one universal JavaScript file.

IGV's `browser` entry points to a non-ESM build. The tested esbuild configuration uses `mainFields: ['module', 'browser', 'main']` to resolve a normal `import igv from 'igv'` to its ESM entry. Record license notices from the build metafile, as for other bundled dependencies. No IGV-specific vendoring step is added ahead of the release-packaging task.

## Implementation boundaries and acceptance criteria

### Reuse existing artifacts

Serve existing workflow and verified cache artifacts unchanged: references and their indexes, alignments and their indexes, variants and their indexes, masks, and annotations. Build review items from existing Sites records and render their locus markers in memory rather than writing a new track file. Never modify a cache or add visualization-only workflow outputs merely for IGV.

Generate a resource only when IGV requires it and no suitable artifact exists, such as an in-memory FASTA index. If a format or index is incompatible, record the limitation and decide whether an existing alternative suffices before proposing a conversion.

### Spike acceptance

- Verify the actual formats and index types produced by the workflows, particularly CSI-indexed VCF and the alignment indexes, against the pinned IGV dependency.
- Verify a reference-consensus run and an accession cache copy through the secured local server, including Range requests and an in-memory FASTA index.
- Record the required CSP allowances, preset options, hidden controls, and SVG export API. Confirm through observed requests that the page loads no external resources.
- Record findings without private data or machine-specific paths. Real runs are local spike inputs only; permanent tests use small synthetic, redistributable fixtures.
- An unsupported required artifact is a decision point, not permission to silently introduce a conversion or new workflow output.

### Resource correctness and lifecycle

- Test generated FASTA index byte offsets with wrapped sequences and different line endings. Cache indexes by path, size, and modification time; do not reuse an index after its source changes.
- Check reference/track sequence compatibility where practical and show mismatches explicitly. Matching sequence names alone do not establish coordinate compatibility; the caller remains responsible for it.
- Serve only explicitly registered resources through opaque IDs. Test malformed and unsatisfiable ranges, missing files and indexes, sources removed or changed after opening, and interrupted streams.
- Replacing a view revokes its resource IDs, cancels outstanding loads, and disposes the old IGV instance. Updates to selection within the same view do not recreate IGV or unnecessarily reset zoom and track choices; a preset or item-specific track change remains intentional.
- Shutdown releases streams and IGV resources and shows the disconnected state rather than leaving a blank page.

### Size and packaging

- Show track file sizes and keep large unindexed annotations and non-selected isolates' reads off by default. Measure initial loading and locus switching with a representative cohort before adding optimizations.
- For this integration, use the full latest evaluated `igv` package as an exact-version development dependency. Do not add a special minified-file extraction or vendoring step.
- Release bundling, transitive-dependency inclusion, license notices, removal of runtime dependencies, and consolidation of package-root/vendor paths remain in [Bundled package](../bundled-package.md); they are not prerequisites for development integration.
- That later task verifies a packed installation contains and serves the necessary browser assets, excludes unnecessary IGV distribution files, and includes the licenses of all used dependencies.
- Keep default genome-catalog loading disabled and external requests blocked by CSP. The latest release's failure-time remote mapping attempt is a known limitation documented in the compatibility findings, not a reason to silently downgrade or claim all error paths make zero external request attempts.

## Deferred viewer refinements

Reverse-strand default colors, an application-owned reference/track settings chooser, an amino-acid and codon-wheel guide, and a circular-view overlay are recorded in [deferred work](../../later.md#genome-view-controls-and-teaching-aids). They are not implemented by the current read-only preview.

## Work

The container's second step, after it was built with the [document kind](document.md), in this order:

1. **Spike** (throwaway, kept only under `/tmp`): serve a real reference-consensus run and an accession cache copy; confirm the CSI-indexed VCF, BAM, an in-memory FASTA index, and an unindexed GFF3 load over `Range` requests; record what the Content Security Policy must allow and that the page makes no other requests; record the igv.js options the presets, the hidden controls, and SVG export need. Successful-load checks are complete; see [compatibility findings](compatibility-findings.md) for observations and remaining production verification.
2. **Read-only genome kind and accession catalog** (implemented as a development preview; release bundling pending): extend the document-specific contract, provider, server, and page; load IGV from the development dependency without special minified-file extraction; implement registered resources with Range support, the in-memory FASTA index when needed, the track chooser, the legend, and visible states. Open a verified cached accession with its available annotation as the first end-to-end integration, with fixture tests. No drafting or exports in this milestone.
3. **Reference-consensus results**: Sites tab, isolate detail, and cohort consensus, each with its view builder and fixture tests. Add locus markers, the item card, presets and zoom, per-locus tracks in their required order, and the guide section in `results.md`. Minimal navigation includes opening at the CLI's selected item, following CLI item changes, and browser previous/next and item selection routed to the opening screen; it does not require panning-follow or region selection.
4. **Region interaction and the two review actions**: panning-follow and region selection, then CLI-owned decision drafting and the draft tray. Move the cohort draft to the persistent result screen before accepting browser suggestions.
5. **Downloads**: SVG and PNG with the container's provenance footer, separately from the read-only milestones.
6. **Further sources**: the annotation review (its steps are in [annotation-review.md](../annotation-review.md#work)), then saved isolate sequences when they exist.

Update researcher documentation and `CHANGELOG.md` alongside implemented features. Each milestone includes failure-path and lifecycle tests and the repository's required test, typecheck, build, and local packaging checks; changes under `workflows/` also require the Python tests.
