# Task 1b — Import isolates from an Illumina delivery

## Goal

Let a researcher point **Manage isolates** at a folder delivered by an Illumina sequencing provider and receive reviewed isolate proposals instead of typing every R1/R2 path. The importer only proposes: nothing enters the catalog until the researcher has reviewed each candidate and saved it through Task 1's validated, locked catalog write.

This task depends on Task 1 (read pairs and the `trimmed` flag). Tasks 2–5 do not depend on it.

## Scope

The first importer is Illumina-specific. Illumina's FASTQ naming and read-header conventions are stable across instruments and delivery channels, while folder layouts are not: a BaseSpace web export, the BaseSpace CLI, and a provider's own repackaging nest the same files differently. Discovery therefore relies on file names and read headers, and treats folder names only as hints.

Other vendors (for example Oxford Nanopore, PacBio, or Element) have different file patterns, header formats, and read layouts. Do not add a vendor abstraction now. When a second vendor is implemented, extract the shared parts — scanning, candidate grouping, the review screen, and saving — from the Illumina-specific parts: file-name and header parsing, and trimmed-read detection.

## Illumina conventions used

File names follow:

```text
<sample>_S<number>_L<lane>_R<read>_<chunk>.fastq.gz
e.g. strain-x_S3_L002_R1_001.fastq.gz
```

- `R1`/`R2` are the mates of a pair; `I1`/`I2` are index reads and are ignored.
- The same sample and S-number in several lanes or runs is one library sequenced more than once.
- A chunk other than `001` means one lane was split into several files per mate. The catalog stores one R1/R2 pair per read set, so report such read sets as unsupported rather than silently using the first chunk.

The first read header identifies the run:

```text
@<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y> <read>:<filtered>:<control>:<index>
```

## Discovery

1. Walk the chosen folder recursively without following directory symlinks, so a link cannot cause loops or escape the chosen folder.
2. Match R1 files to the Illumina pattern and pair each with its R2. Report unmatched mates, index-only files, and non-Illumina FASTQ names instead of dropping them.
3. Read only the first records of each R1 — never decompress whole files — to obtain instrument, run, flowcell, lane, and read lengths.
4. Group pairs into **candidate isolates** by sample name. Within a candidate:
   - pairs with the same run/flowcell/lane but different files are **variants of one read set**, typically raw and provider-processed copies of the same reads, which may even share identical file names in different folders;
   - pairs from different runs or lanes are **separate read sets** whose reads add up.
5. Skip read files the catalog already references and show them as already imported.

## Raw or trimmed

Suggest, never decide:

- **Read lengths:** raw reads share one length equal to the sequencing cycles; varying lengths across the first thousand records suggest trimming. Demultiplexing software can itself trim adapters, so varying lengths alone do not prove provider trimming.
- **Provider reports:** when a BaseSpace `ReportStats.json` is present, its command and input sample name link a processed read set to its raw source.
- **Folder hints:** provider-specific suffixes on dataset folders are shown as context only.

The review preselects untrimmed variants, shows trimmed variants unselected, and lets the researcher confirm every `trimmed` flag. A candidate cannot mix trimmed and untrimmed pairs, as Task 1's validation already requires.

## Review and save

For each candidate, the researcher:

- selects which read sets and which variant of each to include;
- confirms each pair's `trimmed` flag;
- edits the proposed name and ID; the sample name is only a suggestion, and deliveries often prefix sample names with an order code;
- enters `wildtype` and optionally `derived_from`, which sequencing data never contains;
- may skip the candidate.

The review shows instrument, run, flowcell, lane, read length, and file sizes so the researcher can recognize repeat sequencing, but these details are not stored in the catalog; the workflow derives them from the headers again. Saving runs Task 1's read checks and catalog validation for every accepted candidate and writes them in one catalog update, so a partial import never happens.

The importer never renames, moves, merges, or decompresses delivered files.

## Work

- [ ] Parse Illumina FASTQ names and read headers, including index reads, chunks, and malformed names.
- [ ] Scan a folder safely without following directory symlinks and report every FASTQ that is not imported.
- [ ] Group pairs into candidates, read sets, and variants; detect already-cataloged files.
- [ ] Suggest raw/trimmed from read lengths and, when present, BaseSpace reports.
- [ ] Add the import entry, folder selection, candidate review, and a single atomic save through the catalog store.
- [ ] Add synthetic, redistributable fixture trees: a BaseSpace-style export with raw and processed copies sharing file names, a library sequenced on two runs, a plain folder of FASTQs, a missing mate, index reads, and split chunks.
- [ ] Test grouping, suggestions, skipped and unsupported files, review decisions, cancellation, resizing, and the single-write save.

## Acceptance

Pointing the importer at an Illumina delivery lists one candidate per sample with its read sets and variants, explains every file it did not import, and saves only the candidates, read sets, and flags the researcher confirmed. Delivered files are left unchanged.
