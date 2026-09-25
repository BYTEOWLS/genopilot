# Task 1 — Manage isolates

## Goal

Turn the existing **Manage isolates** placeholder into a reusable user-local catalog. A consensus run selects catalog entries instead of asking for an isolate count or repeated FASTQ paths.

## Catalog contract

Each isolate has:

- a stable, unique machine ID;
- an editable name and optional description;
- an optional `wildtype` value: `true`, `false`, or `null` when not recorded;
- an optional `derived_from` reference to another isolate ID;
- one or more local read pairs, each with absolute R1 and R2 paths and an explicit `trimmed` flag.

### Read pairs

Illumina writes one R1/R2 pair per lane per sequencing run. A library sequenced on two runs, for example as a top-up to reach the ordered depth, therefore arrives as two pairs whose reads add up. The catalog lists every pair the researcher assigns to the isolate; the workflow derives run, flowcell, and lane from the read headers, so the catalog does not duplicate them (see [Task 4.1](4a-per-isolate-processing.md)).

`trimmed` records whether the provider already adapter- or quality-trimmed or filtered the pair. Untrimmed reads are preferred because the workflow applies its own pinned, recorded QC to every isolate; trimmed reads remain allowed because some deliveries contain nothing else. File names cannot tell trimmed from untrimmed reads — a provider may deliver both under identical names — so the researcher sets the flag, defaulting to untrimmed. One isolate may mix trimmed and untrimmed pairs, for example a trimmed first delivery and an untrimmed top-up; the workflow trims every pair itself, and the isolate list shows such an isolate as partly trimmed.

Generated isolate-genome records are not part of schema version 1. They arrive with the first action that creates them, **Save to isolate catalog** in [Task 5](5-results-and-post-processing.md#catalog-owned-isolate-genomes), as a deliberate schema revision.

Example shape:

```yaml
schema_version: 1
isolates:
  - id: isolate-a
    name: Isolate A
    description: Wild-type laboratory isolate
    wildtype: true
    derived_from: null
    read_pairs:
      - r1: /data/isolate-a_S1_L001_R1_001.fastq.gz
        r2: /data/isolate-a_S1_L001_R2_001.fastq.gz
        trimmed: false
      - r1: /data/isolate-a_S1_L002_R1_001.fastq.gz
        r2: /data/isolate-a_S1_L002_R2_001.fastq.gz
        trimmed: false
```

Schema version 1 was revised from a single read set to `read_pairs` before its first release, so no stored catalog needs migrating.

The catalog lives at `isolates/isolates.yaml` beside, not inside, the managed tooling directory (`~/.byteowlsGenopilot/` on macOS, `${XDG_DATA_HOME:-~/.local/share}/byteowlsGenopilot/` on Linux), so resetting tooling never removes it. The directory is owner-only and the file is written with `0600` permissions.

`wildtype` and `derived_from` are researcher-supplied metadata; new isolates default to `wildtype: null`. They may be shown during cohort review but never cause automatic inclusion or exclusion. Do not infer wild-type status from the absence of `derived_from`.

## TUI behavior

- List isolates by name and stable ID, with wild-type/derived lineage and read-validation state.
- Create and edit an isolate using typed paths or file choosers for R1 and R2, add and remove read pairs, and mark each pair as already trimmed. The ID is suggested from the name, editable before the first save, and fixed afterwards.
- Import candidates from a sequencing delivery folder is [Task 1b](1b-import-illumina-isolates.md).
- Confirm destructive removal. Refuse removal while `derived_from` children reference the isolate rather than leaving dangling IDs or repairing lineage silently.
- Keep navigation usable without color and at narrow terminal widths.

## Validation

Before saving metadata, reject duplicate IDs, an empty read-pair list, any read file used more than once in the catalog (by path, or through a symlink or hard link within the isolate), non-absolute paths, missing/unreadable files, self-derived isolates, missing parents, and lineage cycles. Perform lightweight FASTQ/compression checks in the manager; Task 4.1 performs authoritative full input validation and mate synchronization before scientific processing.

Catalog writes must be private, atomic, and safe against two application instances overwriting each other. Each write holds an exclusive lock file, refuses to proceed when the file no longer matches the checksum it was loaded with, and replaces the file by renaming a fully written temporary file. A catalog that fails to parse or validate is reported with its path and is never overwritten. The catalog contains local research paths and must not be placed in the repository or a run workspace.

## Work

- [x] Define and validate the versioned isolate catalog schema.
- [x] Resolve a private user-local catalog root containing `isolates.yaml`.
- [x] Implement atomic catalog loading and saving with locking, stale-revision detection, and actionable corruption errors.
- [x] Implement list, create, edit, and remove flows.
- [x] Add R1/R2 file selection and lightweight validation.
- [x] Support several read pairs per isolate with a per-pair `trimmed` flag.
- [x] Make `wildtype` optional (`null` when not recorded) and allow one isolate to mix trimmed and untrimmed pairs, as agreed at the Task 1b kickoff.
- [x] Show lineage and read state without treating labels as behavioral selectors.
- [x] Add tests for validation, lineage cycles, linked or reused read files, mixed trimming, adding and removing pairs, concurrent/failed writes, corruption, resizing, keyboard input, and persistence across restarts.

Generated-genome records, promotion and removal primitives, integrity display, and orphan maintenance moved to [Task 5](5-results-and-post-processing.md#catalog-owned-isolate-genomes), where the first action that creates them lives.

## Acceptance

A researcher can create reusable isolate records, restart the application, and inspect or edit them. No workflow execution is required to complete this task, and no catalog action silently changes a previous run.
