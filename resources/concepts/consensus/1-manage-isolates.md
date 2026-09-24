# Task 1 — Manage isolates

## Goal

Turn the existing **Manage isolates** placeholder into a reusable user-local catalog. A consensus run selects catalog entries instead of asking for an isolate count or repeated FASTQ paths.

## Catalog contract

Each isolate has:

- a stable, unique machine ID;
- an editable name and optional description;
- an explicit `wildtype` value;
- an optional `derived_from` reference to another isolate ID;
- one explicit local paired-end read set with absolute R1 and R2 paths for schema version 1;
- zero or more generated isolate-genome records added by Task 4.1.

Example shape:

```yaml
schema_version: 1
isolates:
  - id: isolate-a
    name: Isolate A
    description: Wild-type laboratory isolate
    wildtype: true
    derived_from: null
    reads:
      layout: paired-end
      r1: /data/isolate-a_R1.fastq.gz
      r2: /data/isolate-a_R2.fastq.gz
    genomes: []
```

`wildtype` and `derived_from` are researcher-supplied metadata. They may be shown during cohort review but never cause automatic inclusion or exclusion. Do not infer wild-type status from the absence of `derived_from`.

## Generated isolate genomes

One isolate can acquire multiple generated FASTA files from different runs or backbones. A result becomes catalog-owned only when the researcher explicitly saves it to the isolate catalog. Saving copies the validated FASTA, index, and compact provenance into managed storage, so deleting the producing run does not remove the reusable genome.

`isolates.yaml` is the authoritative index. It lists every managed genome explicitly; normal catalog loading never treats files found by scanning a directory as valid entries:

```yaml
genomes:
  - id: 2026-01-01_run-a_isolate-a
    isolate_id: isolate-a
    name: Isolate A against T2T v1
    path: genomes/isolate-a/2026-01-01_run-a_isolate-a/genome.fasta
    sha256: "..."
    created_at: 2026-01-01T12:00:00.000Z
    origin: generated
    producing_run:
      id: 2026-01-01_run-a
    workflow:
      id: reference-consensus
      version: 1
    backbone:
      name: T2T v1
      accession: GCF_000149205.2
      sha256: "..."
```

`accession` is optional for a local backbone. The producing run retains complete read, tool, parameter, and command provenance; the catalog copy retains compact provenance and the identity needed to display and verify the genome independently. `isolate_id` must match the containing isolate. Paths are normalized relative paths contained under `genomes/<isolate-id>/<genome-id>/`; reject absolute paths, parent traversal, control characters, ID/path disagreement, and symlink escape.

Promotion first copies files into a private temporary directory, validates their formats and checksums, atomically renames the directory into place, and then atomically updates `isolates.yaml`. A crash may leave an unreferenced directory, but directory contents never become catalog entries implicitly. Removal updates the index before deleting managed files, making a leftover orphan safer than a live entry pointing to deliberately removed data. An explicit maintenance action may report or clean orphaned directories.

## TUI behavior

- List isolates by name and stable ID, with wild-type/derived lineage and read-validation state.
- Create and edit an isolate using file choosers for R1 and R2.
- Show all catalog-owned genomes beneath an isolate, including name, date, backbone, producing run, and checksum state.
- Allow an editable local name for each generated genome without changing its scientific identity.
- Remove a managed genome only after confirming both its index entry and catalog-owned files will be removed.
- Confirm destructive removal. Refuse or explicitly repair references from `derived_from` children rather than leaving dangling IDs.
- Keep navigation usable without color and at narrow terminal widths.

## Validation

Before saving metadata, reject duplicate IDs, the same path as both mates, non-absolute paths, missing/unreadable files, self-derived isolates, missing parents, and lineage cycles. Perform lightweight FASTQ/compression checks in the manager; Task 4.1 performs authoritative full input validation and mate synchronization before scientific processing.

Catalog writes must be private, atomic, and safe against two application instances overwriting each other. The catalog contains local research paths and must not be placed in the repository or a run workspace.

## Work

- [ ] Define and validate the versioned isolate catalog and generated-genome record schemas.
- [ ] Resolve a private user-local catalog root containing `isolates.yaml` and managed genome directories.
- [ ] Implement atomic catalog loading and saving with locking, contained-path validation, and actionable corruption errors.
- [ ] Implement list, create, edit, and remove flows.
- [ ] Add R1/R2 file selection and lightweight validation.
- [ ] Show lineage and generated-genome integrity without treating labels as behavioral selectors.
- [ ] Implement safe promotion/removal primitives for later workflow result screens.
- [ ] Add tests for validation, lineage cycles, contained paths, symlink escape, orphan recovery, concurrent/failed writes, resizing, keyboard input, and missing generated artifacts.

## Acceptance

A researcher can create reusable isolate records, restart the application, inspect or edit them, and see zero or more explicitly indexed, catalog-owned FASTAs. No workflow execution is required to complete this task, and no catalog action silently changes a previous run.
