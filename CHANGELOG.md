# Changelog

All notable changes are documented here. Versions follow Semantic Versioning and remain in the `0.x.x` range while the CLI and workflow contracts are under active development.

---

## [Unreleased]

- Accept several regions separated by spaces in the genome Region field and show them side by side; the field, wheel zoom, clicked positions, panning, and track separators follow each panel, and the zoom buttons zoom all panels. Correct the transfer guide, which promised a search by transcript ID that the Region field does not offer.

- Rename the general genome help to *Using the genome viewer* and list a view's own guide first in the help menu, set apart from the general guide by a divider.

- Lay out the genome track chooser as a switch beside each track's name and file size, which wrap in their own column; only loading and failed states are written out.

- Fix unreadable genome track labels (light text on IGV's white label background in dark mode): GenoPilot's viewer styles now outrank IGV's adopted stylesheet, which also lets the track area reach the bottom of the canvas for panning.

- Size genome annotation and variant tracks to their content, let researchers drag (or use ↑/↓ on) the separator below any track to set its height and double-click it to reset; dragging the empty space below the last track pans the view; a track resized taller than its content no longer lets a vertical drag move the content below its top edge.

- Name where a browser view was opened from in its headline, such as the workflow and run (`Workflow "<label>": <run>: <view>`) or the accession catalog.

- Group the genome help menu by guide: a guide's sections move into its own submenu, opened with Whole guide first, instead of being listed beside the guides.

- Add per-track Show `region` records and Show `chromosome` records switches for GFF3 annotation tracks in genome Settings (`region` shown, `chromosome` hidden by default, as before), and explain whole-sequence records and overlapping annotation rows in genome help.

- Open an annotation transfer's genomes in the browser with `v`: the target with the transferred annotation and LiftOn's unverified intermediate Liftoff and miniprot annotations (hidden by default), or the reference with its source annotation. Verified files are checked against `artifacts.yaml` before they are served; the workflow's result help gains a guide to reading the views.

- Identify annotation codon fills by their native drawing scope, keeping codon shading and start/stop highlights independent of custom strand colors that match IGV's literal colors.

- Separate genome palette rules, canvas glyph drawing, geometry, and wrapper lifecycle; document track-scoped color mappings and deliberate evidence-color preservation. Add opt-in, local-only unmapped-paint diagnostics in Settings with deduplication, bounded collection, and no source or biological metadata.

- Recheck genome evidence when reopening so restored files become available; keep selection-only updates separate and release removed tracks' theme state during locus review.
- Share cancellable genome opening between CLI screens, isolate genome navigation/display settings, and reuse backbone verification and Markdown section extraction.

- Use lighter/darker shades of each annotation feature's strand color for amino-acid codon backgrounds, including custom reverse-strand colors, with contrasting text and distinct start/stop highlights retained.

- Structure genome click details by evidence type with expanded field names and a Markdown glossary; preserve separate annotation feature blocks with gene/transcript/exon/CDS headings and expand common GFF3 keys such as `gbkey`. Link researcher-facing IGV Desktop guides rather than developer documentation. Add a dedicated × close button, keyboard/pointer panel resizing, and a visible wheel toggle between zoom and vertical track scrolling.

- Add a standard-genetic-code codon sun mapping table to genome help, with coding-direction guidance and alternative-code caveats.

- Hide IGV’s native track cog controls; use the extracted genome display settings and track chooser instead.

- Use magnifying-glass icons for genome zoom controls, retaining accessible labels and disabled states.

- Contain IGV’s internal stacking layers so track elements and boundaries stay below genome settings, track chooser, and help overlays.

- Separate genome tracks with theme-aware horizontal boundaries and contrasting gutters, keeping track edges visible when labels are hidden without changing canvas colors or genomic geometry.

- Skip superseded locus loads and hide outdated evidence while the current selection loads; suspend background navigation shortcuts in help overlays, and disable failed optional annotations without blocking usable Sites evidence.

- Turn genome `?` help into a topic menu with reading-guide sections, source provenance, and dynamically supplied review guides such as Sites genome review; read topics in a dialog instead of a separate review-guide panel.

- Add a global Show track labels switch to genome Display settings, including tracks loaded later; keep names available in the chooser.

- Move the genome track chooser beside Display settings into a scrollable Mantine switch list, retaining file sizes and visible availability notices.

- Add a read-only Sites genome-review preview at the CLI's selected locus, with synchronized locus navigation, in-memory markers, recorded vote cards, per-locus evidence ordering, presets, and a review guide; verify the backbone and any matching cached annotation before opening. Decision drafting and exports remain deferred.

- Open isolate backbone evidence and a selected completed cohort consensus from run results with `v`, checking reference checksums and serving existing BAM/BAI, VCF/CSI, and BED artifacts locally without conversions; keep consensus and backbone coordinates separate.
- Explain whole-read coloring in click details with an original-IGV-color chip and read-specific pairing reason, including IGV thresholds only when they explain a short/long fragment; capture alignment popup targets because IGV's public click event supplies features only for annotations. Add a paired-read color legend and link to IGV's alignment documentation.
- Scale aligned-read lane heights with viewer text size and center filled mismatch letters without changing genomic coordinates or read packing; theme nucleotide-glyph brightness while retaining base-quality opacity and original IGV whole-read, coverage, and connector colors. Move text controls into Display settings and add alignment coverage/read visibility and expanded/compact lane controls.

- Add a visible genome display-settings chooser for reference orientation/three-frame translation and annotation strand colors/layout; explain amino-acid abbreviations and the viewer's standard-genetic-code limitation.
- Use theme-matched teal/rose translation-marker fills and contrasting start/stop labels without recoloring DNA bases; vertically center three-frame letters and marker labels within their bars.

- Distinguish forward-strand annotations in blue from reverse-strand annotations in purple, with contrast-aware shades in both genome-view themes and unchanged start/stop codon highlights.

- Add a read-only accession genome-view development preview using IGV, with verified cache checksums, in-memory FASTA indexing, secure byte-range serving, annotation controls, and visible loading/errors. Release bundling remains pending; installations without IGV mark genome viewing unavailable.
- Give genome tracks the available width and a taller responsive viewport; show click-selected feature details in a themed inline panel instead of hover text or IGV popups.
- Move genome guidance and provenance into a `?` button, keep controls above the viewer, and add pointer-anchored wheel zoom, a crosshair, and a chromosome/contig selector and overview.
- Keep checksum-verified file identities through genome-view publication, use in-place wheel zoom, and offer an all-chromosomes ruler including short contigs.
- Theme genome backgrounds, rulers, annotation tracks, and labels in place while preserving nucleotide hues; use contrast-aware blue for annotations in light and dark modes.
- Fill DNA glyphs with contrast-adjusted nucleotide colors and faint backplates; give translated protein codons opaque theme-aware fills and contrasting letters, preserving start/stop highlights.
- Resolve annotation colors inside IGV's shadow tree with a valid fallback, keeping exon fills visible before amino-acid letters appear.
- Increase default genome text size and add smaller/larger controls for track labels, DNA letters, and bp coordinates, with matching row spacing and closer zoom.
- Await and serialize genome zoom, region, and resize loads so failures surface in the viewer; abort accession checksum reads on cleanup and validate supplied FASTA indexes against the actual reference layout.
- Clear browser document-selection notices instead of leaving them on every CLI screen.

- Open documentation in a local browser with `v`, with synchronized document selection, a collapsible outline and print/PDF support through the browser's normal Print command.
- Use a Mantine browser frame with a trailing icon button cycling automatic, light, and dark themes; all assets and dependency license notices are packaged locally.

## [0.0.1] - 2026-09-30

First release: a guided terminal interface for curated, reproducible genome workflows. Every workflow also runs directly through Snakemake.

### Workflows

- **Annotation transfer**: copies a reference genome's gene annotation onto a target genome with LiftOn. The reference and target each come from a local file or a versioned NCBI assembly accession. The input FASTA and GFF3 files are validated before LiftOn starts, the transferred GFF3 is validated afterwards, and the run reports per-feature transfer, metrics, and mutation classes.
- **Reference consensus**: builds one consensus genome from a backbone and a cohort of isolates' Illumina reads. Each isolate is trimmed, aligned, and called separately. Every position is then decided by a strict-majority or plurality vote, and positions without a clear winner are written as `N` or IUPAC codes, never guessed. Iterations rerun only the vote with other isolates or settings, each with a saved, reasoned decision.
- Every run records its configuration, decisions, commands, tool versions, logs, and the checksum of every artifact, and marks each input as generated or imported.

### Application

- `genopilot` command (alias `gnp`) with a home screen, a two-press `Ctrl+C` exit, layouts that adapt to the terminal size and stay usable without colour, and mouse-wheel scrolling.
- Consent-based setup of pinned Snakemake and Conda through a verified Pixi download in a user-local directory, and `genopilot update` for self-updates.
- New-run forms built from each workflow's manifest, prefilled from previous runs, with a review before a dry run or a real execution and the exact Snakemake command shown.
- Live execution view with per-stage and per-isolate progress and a scrollable log, and complete stdout and stderr logs kept for every attempt.
- Result pages in tabs for both workflows, plus **Open existing run** to reopen or delete earlier runs.
- **Manage isolates**: a user-local isolate catalog with read files and lineage, which can import a sequencing delivery folder after a review.
- **Manage NCBI accessions**: a catalog of labelled accessions with NCBI metadata, reusable verified download caches, and an optional NCBI API key.
- **Help**: the Markdown documentation, rendered in the application as on GitHub, including each workflow's science and its result page.
