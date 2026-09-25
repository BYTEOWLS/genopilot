# Changelog

All notable changes are documented here. Versions follow Semantic Versioning and remain in the `0.x.x` range while the CLI and workflow contracts are under active development.

---

## [Unreleased]

### Added

- `genopilot` command (short alias `gnp`) with an Ink welcome screen showing package metadata, tooling status, keyboard command selection, responsive layout, and double-`Ctrl+C` exit confirmation.
- Text fields with Backspace and Delete on either side of the cursor, Home/End and Ctrl+A/Ctrl+E (Cmd+←/→ where the terminal sends them) for the line start and end, and Option+←/→ and Option+Backspace for words; Backspace at the start of a field no longer deletes the text after the cursor.
- `h` returns to the home screen from any nested screen; it is typed into a focused text field and unavailable while a run, deletion, or save is in progress.
- Terminal window title set from the package label, extended with the selected workflow's label, a ⏳ mark while Snakemake runs, a ✔ or ✖ outcome mark once it finishes, and restored on exit.
- Consent-based, user-local tooling setup under a managed `~/.byteowlsGenopilot` directory (XDG data path on Linux): verified Pixi downloads, pinned Snakemake and Conda, version validation against supported ranges, per-tool availability markers, streamed installation progress, cancellation, and retryable checks.
- Background update notice and `genopilot update`, a non-interactive self-update that installs the exact newer npm release.
- **Manage isolates** command with a user-local, versioned isolate catalog: create, edit, and remove isolates with a suggested stable ID, optional wild-type (yes, no, or not recorded) and `derived_from` lineage metadata, and one or more R1/R2 FASTQ pairs (one per lane or run), each typed (including `~` paths) or chosen from a file browser that opens beside the pair's other mate, and flagged when already trimmed by the provider; lightweight plain/gzip FASTQ checks; rejection of duplicate IDs, a read path used twice anywhere in the catalog or one file reached twice through links within an isolate, missing parents, and lineage cycles; removal refused while other isolates derive from the isolate; and locked, atomic saves that detect edits from another window and never overwrite a corrupt catalog.
- Import isolates from an Illumina sequencing delivery folder: a read-only scan groups FASTQ pairs by sample into read sets (per lane and run, lane-merged files included) and copies of the same reads, samples at most about 1,000 records per file with bounded memory, reports every file it does not propose with its reason (index reads, split chunks, undetermined reads, missing or mismatched mates, invalid FASTQ, links leaving the folder, files already in the catalog), and suggests raw or trimmed reads from read lengths; a review lets the researcher create new isolates or add read sets to existing ones, pick one copy per read set, and confirm each trimmed flag, with a help page (`?`) that explains every review row, and all accepted isolates are saved in one catalog update that keeps review decisions when another window changed the catalog. Delivered files are never modified.
- **NCBI access** command to enter, replace, and clear an optional NCBI Datasets API key, stored in a private user-local file, never rendered in full, and passed to runs only through the child-process environment.
- New-run flow with packaged workflow discovery by stable ID and a manifest-driven configuration form: sections, required markers, defaults, placeholders, previews, conditional fields, typed or browsed file paths, radio choices, validation, and confirmation.
- Prefill the form from previous runs with PageUp/PageDown (or `fn` + ↑/↓), listing each run by its name and creation time.
- Packaged `annotation-transfer` workflow with strict, versioned manifest and configuration contracts, a pinned LiftOn 1.0.13 same-species profile, requested and effective CPU selection, an optional annotation ID prefix, and declared presentation stages and result artifacts.
- Reference (FASTA + GFF3) and target (FASTA) inputs that each come from a local path or a versioned NCBI assembly accession, with detection of existing accession caches and an explicit, saved choice to reuse or refresh them.
- Run directories named by a validated `run.id` (UTC timestamp plus a filesystem-safe run name), with the run name, description, and `run.created_at` recorded in `config.yaml`.
- Start a saved run as a dry run or a real execution, chosen independently, with the exact managed Snakemake command shown before starting and timestamped stdout/stderr logs kept for every attempt.
- Execution screen with a terminal-sized, scrollable live log (arrow keys, PageUp/PageDown, `g`, `G`) and per-stage progress read from a versioned `events.jsonl`, which a packaged Snakemake logger plugin also writes when the workflow runs without the TUI.
- Snakemake per-rule Conda environments shared across runs through a managed `conda-envs` directory, while each run keeps its own job metadata and locks.
- Run-results screen with annotation-transfer metrics labelled by their counting unit, validation status, missing-artifact warnings, direct report and evidence paths, provenance, and complete-log locations; a finished execution stays on screen until results are requested.
- Result help page (`?`) explaining every result item, the definitions recorded with the run, and each LiftOn transfer method and mutation class.
- **Open existing run** command listing runs in the default `runs` collection with compatibility and status checks, opening their persisted results without starting Snakemake, and permanently deleting a run only after explicit confirmation.
