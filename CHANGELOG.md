# Changelog

All notable changes are documented here. Versions follow Semantic Versioning and remain in the `0.x.x` range while the CLI and workflow contracts are under active development.

---

## [Unreleased]

### Runtime

- Pixi 0.82.1, Snakemake 9.27.1, and Python 3.13.16, also in the rule environments; existing installations are asked to run setup again. Conda stays at 26.7.3: newer versions require a `packaging` release that Snakemake does not yet allow.
- NCBI Datasets CLI 18.39.0.
- Existing reference-consensus runs need a new run for further iterations: the new Python pin makes their per-isolate results out of date.

### Provenance

- A run's citation includes igv.js, the genome viewer, with its version.

### Application

- Cancellation during run setup no longer starts a Snakemake process; opened logs are closed before returning.
- Accession details group assembly facts, release date, genome size, GC percentage, contig/scaffold counts and N50, and BioProject/BioSample links into sections. Refresh metadata to fill new fields on existing entries. PageUp/PageDown scrolls details while editable fields and Save stay visible on short terminals.
- Isolates now own stable read sets with multiple file groups and confirmed library identities. Runs explicitly select read sets and snapshot effective Illumina preprocessing; poly-G is Auto / On / Off, and provider-trimmed groups skip fastp. Archive-renamed paired-end Illumina reads are supported. Old catalog/run structures are unsupported; re-import catalogs and create new runs. Schema versions remain at 1, with no migration.
- Empty isolate lists use warning alerts. New Illumina read sets default to two-colour chemistry and poly-G Auto (On); import review shows an info message pointing to isolate details to change these settings. Existing saved settings are unchanged.
- Illumina chemistry distinguishes four-colour, two-colour, one-channel, and unknown. Non-string chemistry and poly-G values are rejected rather than coerced. Poly-G Auto is On for two-colour and Off for four-colour; one-channel and unknown require an explicit choice when trimming runs. The old `other` value is unsupported.
- Isolate editing groups pairs within read sets, shows technique once in its details, and uses spaced, bracketed action buttons.
- Isolate management opens general Help beside one Markdown file/tab per supported technique, currently Illumina, in the documentation index and via `?` in list/edit screens. Chemistry choices, common instruments, and poly-G behaviour are explained without losing unsaved edits.
- Library IDs are prefilled as editable suggestions, without silently reusing an existing preparation's identity. Illumina helpers are grouped in their own source folder.
- Forms, result views, tooling, and command sections share one headed `Section` layout, borderless by default with opt-in borders and visibly indented nested groups. Read-set forms follow the selected field on shorter terminals. Chooser rows omit UUIDs, lineage, and repeated names while keeping incompatibility reasons visible below the list. The isolate list groups entries by sequencing technique and omits successful read-check status and false/unknown wild-type badges.
- Reference-consensus calling settings have clearer configuration hints and Help explanations, including Q20/Q30 and allele-fraction examples. Configuration reviews show the same parameter hints as the form.
- Ctrl+A in the isolate picker selects every isolate matching the search, or all of them without one; pressing it again deselects them.

### Results

- Every run records the machine that saved its configuration (CPUs, memory, CPU model, operating system) in `config.yaml` and its provenance; the result page shows it.
- Runs show elapsed time while running and saved execution and stage timings in results.
- The list of existing runs shows how many runs each workflow has and how long each run took.
- GenoPilot samples a run's peak memory while it executes and shows it with the run's timing.
- A new run is saved when its first dry run or execution starts, so leaving the start page without starting one no longer leaves a run in the list of existing runs.
- Before a run, its review shows free disk, available CPUs, and installed memory, with the run's estimated disk need and a warning when it may not fit. After a completed run on the same machine, the estimate uses its measurement and adds the expected duration and peak memory.

## [0.0.2] - 2026-10-08

### Provenance

- `pnpm publish` builds the package as a release build and refuses uncommitted changes; only runs of a release build are marked citable.
- Every finished run writes how to cite it to `citation/CITATION.md`: whether it is citable, the tools that ran with their versions and references, a draft methods paragraph built from the configuration, and the references as BibTeX and RIS. The result page shows it on a Citation tab; in the browser view, `v` on that tab and the **Cite this run** button of every view opened from the run show it with buttons that copy each part as plain text.
- Every run records the GenoPilot version and build that saved its configuration, in `config.yaml` and `provenance/run.json`; the result page and the browser view show it, and mark runs of a development build.

### Community

- A contributing guide, a security policy, a code of conduct, and issue forms for bug reports and workflow proposals.

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
- **Reference consensus**: fastp, which trims adapters from each isolate's reads, is updated to a release that fixes an adapter-trimming problem. A run started before the update redoes trimming and every later step of its isolates when it continues.

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
