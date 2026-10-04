# Changelog

All notable changes are documented here. Versions follow Semantic Versioning and remain in the `0.x.x` range while the CLI and workflow contracts are under active development.

---

## [Unreleased]

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
