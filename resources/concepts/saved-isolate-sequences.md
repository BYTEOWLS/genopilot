# Saved isolate sequences

## Goal

Let a researcher explicitly save a validated isolate FASTA from a run into the isolate catalog of **Manage isolates**, so deleting the producing run does not remove the reusable sequence.

Split out of the [reference-guided cohort consensus](done/consensus/README.md) concept, whose other tasks are implemented. It is independent of the cohort iterations and reads the promotion candidates of consensus [Task 4.1](done/consensus/4a-per-isolate-processing.md).

## Saved sequences

The isolate catalog is independent of every workflow. It stores sequences of an isolate without assuming how they were made; each entry records its kind and origin instead. This concept adds the first kind, the reference-guided consensus of consensus Task 4.1: the backbone with the isolate's variants applied and `N` wherever the isolate is not callable. It is not an assembly: it has the backbone's structure and lacks sequence the backbone lacks. A later kind, such as an imported assembly, needs a new way to add entries but no new schema.

One isolate can hold several sequences, for example from different runs or backbones. A result enters the catalog only when the researcher explicitly saves it. Saving copies the validated FASTA, its index, and compact provenance into the catalog's own storage, so deleting the producing run does not remove the saved sequence. Scientific outputs never depend on that user-local action.

This section was moved from consensus [Task 1](done/consensus/1-manage-isolates.md), which implemented only isolate metadata. Adding `sequences` to each isolate is a deliberate revision of the catalog schema.

## An isolate is the sample

An isolate is the biological sample, not its reads. Its own fields (`name`, `description`, `wildtype`, `derived_from`) describe the organism. Everything else is data about it, grouped by kind:

- `reads`: the paired reads a sequencing provider delivered, referenced where they lie. They are the input of a run.
- `sequences`: saved FASTA files of the isolate, copied into the catalog. They are outputs, of a run or later of an import.

Today `read_pairs` sits next to the sample's metadata, so the schema reads as if an isolate were its reads. The revision renames it to `reads`, keeping the same entries (`r1`, `r2`, `trimmed`), and adds `sequences` beside it. An isolate still needs at least one read pair, because every current kind of sequence is generated from reads; a later import of sequences without reads revisits that rule. The **Manage isolates** screen shows the two groups as such.

The revision is part of this concept and is not implemented before it. It touches everything that reads `read_pairs`:

- the catalog, its validation, the isolate manager, and the Illumina import (`src/isolates/`, `src/ui/isolates-screen/`);
- the run's `isolates.yaml` snapshot, which copies the catalog's isolate entries, and the reference-consensus Snakefile and scripts that read it (`read_pairs` in `workflows/reference-consensus/`), together with their tests and fixtures.

The snapshot keeps only what a run reads: the sample's metadata and its `reads`, never its saved `sequences`. Before the first release the schemas change without a version bump or migration.

`isolates.yaml` is the authoritative index. It lists every saved sequence explicitly under its isolate; normal catalog loading never treats files found by scanning a directory as valid entries:

```yaml
isolates:
  - id: isolate-a
    name: Isolate A
    wildtype: true
    derived_from: null
    reads:
      - r1: /data/isolate-a_S1_L001_R1_001.fastq.gz
        r2: /data/isolate-a_S1_L001_R2_001.fastq.gz
        trimmed: false
    sequences:
      - id: 2026-01-01_run-a_isolate-a
        name: Isolate A against T2T v1
        kind: reference-guided-consensus
        origin: generated
        path: sequences/2026-01-01_run-a_isolate-a/sequence.fasta
        sha256: "..."
        created_at: 2026-01-01T12:00:00.000Z
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

- `kind` says what the sequence is; `reference-guided-consensus` is the only kind for now. The isolate manager shows it, so a consensus is never mistaken for an assembly.
- `origin` is `generated` for a sequence a GenoPilot run produced. `producing_run` and `workflow` are required for a generated sequence.
- `backbone` belongs to the kind `reference-guided-consensus` and is validated for it only; `accession` is optional for a local backbone.
- The producing run keeps the complete read, tool, parameter, and command provenance. The catalog keeps the compact provenance and the identity needed to display and verify the sequence on its own.

Storage is one directory per saved sequence, next to the index:

```text
isolates/
  isolates.yaml
  sequences/
    2026-01-01_run-a_isolate-a/
      sequence.fasta
      sequence.fasta.fai
      provenance.json
```

A sequence's ID is unique across the whole catalog; the producing run's ID and the isolate's ID make it so for generated sequences. The entry's isolate is the one it is listed under, so the path does not repeat it. Paths are normalized relative paths of the form `sequences/<sequence-id>/<file>`; reject absolute paths, parent traversal, control characters, a directory that disagrees with the ID, and symlink escape.

Saving first verifies the consensus Task 4.1 promotion candidate against the run directory: its isolate ID is the selected isolate, its FASTA and index lie inside that isolate's result directory, and their checksums and the backbone's match. Tests cover valid and invalid candidates. It then copies the files into a private temporary directory, validates their formats and checksums, atomically renames the directory into place, and then atomically updates `isolates.yaml`. A crash may leave an unreferenced directory, but directory contents never become catalog entries implicitly. Saving the same sequence again, with the same ID and checksum, changes nothing; another run or backbone creates a separate entry rather than replacing an older one. Removal updates the index before deleting the files, making a leftover orphan safer than a live entry pointing to deliberately removed data. An explicit maintenance action may report or clean orphaned directories.

An annotation transferred onto a saved sequence can later be saved under that sequence, in `sequences/<sequence-id>/annotations/`; that is a [later idea](../later.md#saved-annotations-in-the-isolate-catalog) and not part of this concept. The per-sequence directory leaves room for it.

The isolate manager then:

- shows all saved sequences beneath an isolate, with name, kind, date, backbone, producing run, and checksum state;
- allows an editable local name for each saved sequence without changing its scientific identity;
- removes a saved sequence only after confirming that both its index entry and its files will be removed.

## Work

- [ ] Group an isolate's data: rename `read_pairs` to `reads` in the catalog, the run snapshot, the workflow, and their tests, and show reads and saved sequences as separate groups in the isolate manager.
- [ ] Revise the isolate-catalog schema with validated sequence records (kind, origin, and kind-specific fields), contained paths, and symlink-escape checks.
- [ ] Implement safe saving and removal primitives, orphan reporting, and integrity display in the isolate manager.
- [ ] Offer **Save to isolate catalog** from the results view for eligible isolate FASTAs, and show there which ones are already saved; the view of consensus [Task 5.2](done/consensus/5b-results-view.md) shows only whether a candidate is available.
- [ ] Add tests for saving, invalid candidates, repeated saving, contained paths, symlink escape, and orphan recovery.

## Acceptance

A researcher can save validated isolate FASTAs into the isolate catalog, see them with their kind under their isolate, and remove them safely.
