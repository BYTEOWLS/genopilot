# Task 5.4 — Catalog-owned isolate genomes

## Goal

Let a researcher explicitly save a validated isolate FASTA from a run into durable catalog-owned storage, so deleting the producing run does not remove the reusable genome.

Independent of the iteration work in Tasks 5.1–5.3; it reads Task 4.1's promotion candidates.

## Catalog-owned isolate genomes

One isolate can acquire multiple generated FASTA files from different runs or backbones. A result becomes catalog-owned only when the researcher explicitly saves it to the isolate catalog. Saving copies the validated FASTA, index, and compact provenance into managed storage, so deleting the producing run does not remove the reusable genome. Scientific outputs never depend on that user-local action.

This section was moved from [Task 1](1-manage-isolates.md), which implemented only isolate metadata. Adding `genomes` to each isolate is a deliberate revision of the catalog schema.

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

Promotion first verifies the Task 4.1 promotion candidate against the run directory: its isolate ID is the selected isolate, its FASTA and index lie inside that isolate's result directory, and their checksums and the backbone's match. Tests cover valid and invalid candidates. It then copies files into a private temporary directory, validates their formats and checksums, atomically renames the directory into place, and then atomically updates `isolates.yaml`. A crash may leave an unreferenced directory, but directory contents never become catalog entries implicitly. Removal updates the index before deleting managed files, making a leftover orphan safer than a live entry pointing to deliberately removed data. An explicit maintenance action may report or clean orphaned directories.

The isolate manager then:

- shows all catalog-owned genomes beneath an isolate, including name, date, backbone, producing run, and checksum state;
- allows an editable local name for each generated genome without changing its scientific identity;
- removes a managed genome only after confirming that both its index entry and its catalog-owned files will be removed.

## Work

- [ ] Revise the isolate-catalog schema with validated generated-genome records, contained paths, and symlink-escape checks.
- [ ] Implement safe promotion and removal primitives, orphan reporting, and genome integrity display in the isolate manager.
- [ ] Offer **Save to isolate catalog** from the results view for eligible isolate FASTAs.
- [ ] Add tests for catalog promotion, invalid candidates, contained genome paths, symlink escape, and orphan recovery.

## Acceptance

A researcher can save validated isolate FASTAs into durable catalog-owned storage, see them under their isolate, and remove them safely.
