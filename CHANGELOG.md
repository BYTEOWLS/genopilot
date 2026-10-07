# Changelog

All notable changes are documented here. Versions follow Semantic Versioning and remain in the `0.x.x` range while the CLI and workflow contracts are under active development.

---

## [Unreleased]

### License

- GenoPilot is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`) instead of MIT. Versions already published remain available under MIT. Other terms, such as a commercial license, are available from the author.

### Packaging

- The package is one bundled `dist/cli.js` without runtime dependencies, so every installation runs exactly the dependency versions the release was built and tested with. It is also much smaller to install. The bundled packages' licenses are in `dist/THIRD-PARTY-LICENSES.md`.

### Browser view

- `v` opens documentation and genomes in a local browser, kept in step with the CLI. Everything it needs, including its dependencies' license notices, is packaged; the theme follows the system or can be set to light or dark.
- **Documentation**: the selected document with a collapsible outline, printable or saved as PDF through the browser's Print command.
- **Genome viewer** (IGV), read-only: verified files only, served locally byte by byte without conversion.
  - Navigation: a chromosome or contig selector with an overview, an all-chromosomes ruler, a Region field that accepts several regions side by side, wheel zoom around the pointer or vertical scrolling, a crosshair, and panning by dragging.
  - Tracks: a track chooser with file sizes, empty files, and loading or failure states, tracks sized to their content with draggable separators, theme-aware colours with forward and reverse strands in blue and purple, translated codons with start and stop highlights, and an optional three-frame translation.
  - Settings: text size, track labels, annotation layout and strand colours, `region` and `chromosome` record switches, and alignment coverage, read, and lane controls.
  - Click details: structured by evidence type with expanded field names, a read-colour legend, and a resizable panel.
  - Help: a `?` menu with the view's own guide, the general *Using the genome viewer* guide, and the sources with their provenance.
  - Review views step through a list the CLI leads, with presets, an item card, markers that show an item's facts when clicked, and track choices that last from one item to the next.
- Genomes open from the accession catalog, from reference consensus results, and from annotation transfer results; each headline names where a view was opened from.
- The genome viewer is bundled into the published package, so genome views also work from an npm installation.

### Workflows

- **Annotation transfer**: every coding gene's protein is rated from LiftOn's results. Each gene gets a protein category, its LiftOn status, its unresolved bases (not A, C, G, or T) in the coding sequence, and review reasons (unmapped or lost, disrupted, below the new *Minimum protein identity* parameter, default 99%, or unresolved bases), recorded in `results/feature-transfer.tsv` together with each feature's reference position. Counts go to `results/metrics.json`, and the target's unresolved intervals to `results/target-unresolved.bed`.
- **Annotation transfer results**: a new *Proteins* tab summarizes the rated genes as exact matches, near matches, and genes that need review, and lists those genes in review order with a reason filter and a gene detail. The Overview reports the target's unresolved bases. `v` opens the target or reference genome, or, on the Proteins tab, the selected gene in a review view that walks the list with the Liftoff and miniprot annotations, which carry the reference gene into the target's coordinates.
- **Reference consensus results**: `v` opens an isolate's backbone evidence, a completed cohort consensus, or a read-only Sites review that steps through the loci of the CLI's list with their recorded votes. The Overview suggests annotating the consensus with an annotation transfer and names its inputs.

### Application

- Informational alerts use a lighter blue that stays readable on dark terminals.
- The tooling page shows GenoPilot's version, the Git commit it was built from, and the commit date, so development builds that share a version can be told apart.

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
