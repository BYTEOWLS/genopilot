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
<sample>_S<number>[_L<lane>]_<read>_<chunk>.fastq.gz
e.g. strain-x_S3_L002_R1_001.fastq.gz
     strain-x_S3_R1_001.fastq.gz
```

- Parse names from the right, because sample names often contain underscores: `^(.+)_S(\d+)(?:_L(\d{3}))?_(R[12]|I[12])_(\d{3})\.fastq\.gz$`.
- `R1`/`R2` are the mates of a pair; `I1`/`I2` are index reads and are ignored.
- The lane is optional. By default, demultiplexing writes one file per lane; with lane merging (`--no-lane-splitting`), all lanes of a flowcell are concatenated into one file per sample and the name carries no lane.
- The same sample in several lanes or runs is one library sequenced more than once. Its S-number is its position on each run's sample sheet and may differ between runs.
- A chunk other than `001` means one lane was split into several files per mate. The catalog stores one R1/R2 pair per read set, so report such read sets as unsupported rather than silently using the first chunk.
- `Undetermined_S0_…` holds reads whose index matched no sample on the sample sheet (index sequencing errors, index hopping, PhiX, adapter dimers, contamination). It belongs to no sample and is never proposed.

The first read header identifies the run:

```text
@<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y> <read>:<filtered>:<control>:<index>
```

The importer uses instrument, run, and flowcell from the header. It never uses the header's lane: in a lane-merged file the first record's lane does not describe the file, and a filtered copy may start with a different read.

## Discovery

1. Walk the chosen folder recursively without following directory symlinks, so a link cannot cause loops or escape the chosen folder. Use a file symlink only when its real path lies inside the chosen folder. Report unreadable subfolders instead of failing the scan. The scan can be cancelled.
2. Match R1 files to the Illumina pattern and pair each with its R2 in the same folder. Report every FASTQ that is not imported, with its reason: non-Illumina name or read header, undetermined reads, index read, split chunk, missing or mismatched mate (naming the failing mate), invalid or unreadable FASTQ, a link leaving the chosen folder, or a second path to a file already found (the file itself is preferred over a link to it).
3. Stream the start of each R1 through gunzip, stopping after a fixed number of records (about 1,000) or a hard limit on compressed bytes, whichever comes first; never decompress whole files. Limit decompressed bytes and line length as well, so a small, highly compressed file cannot exhaust memory. Read only the first record of each R2 and require its read name to match R1's, ignoring the header comment.
4. Group pairs into **candidate isolates** by sample name, and pairs within a candidate by the key (run, flowcell, lane from the file name or none):
   - pairs with the same key are **variants of one read set** — the same reads, typically raw and provider-processed copies, which may share identical file names in different folders;
   - pairs with different keys are **separate read sets** whose reads add up, such as two lanes or a top-up run.
5. Mark read files the catalog already references, by path or by the same device and inode, as already imported.

## Raw or trimmed

Suggest, never decide. Show the evidence for each suggestion:

- **Read lengths:** raw reads share one length equal to the sequencing cycles; varying lengths across the sampled records suggest trimming. Demultiplexing software can itself trim adapters, so varying lengths alone do not prove provider trimming. Adapter trimming shortens only reads from fragments shorter than the read length, often a few percent, which is why about 1,000 records are sampled.
- **Variant comparison:** within a read set, the variant with varying lengths or the smaller file is suggested as the processed copy. This relative signal is stronger than either variant's lengths alone.
- **Provider reports:** when a BaseSpace `ReportStats.json` is present, parse it defensively; its command and input sample name link a processed read set to its raw source. A malformed or unknown report is shown as unreadable, never guessed at.
- **Folder hints:** provider-specific suffixes on dataset folders are shown as context only.

## Review and save

The review preselects the untrimmed variant of each read set and lets the researcher confirm every `trimmed` flag. For each candidate, the researcher:

- chooses whether it creates a new isolate or adds its read sets to an existing isolate; "add" is preselected when the sample name matches an existing isolate's name or ID, which covers a top-up run delivered after the first import;
- selects which read sets to include and at most one variant of each, because two variants are the same reads and would be counted twice;
- confirms each pair's `trimmed` flag; one isolate may hold both trimmed and untrimmed pairs;
- for a new isolate, edits the proposed name and ID — the sample name is only a suggestion, deliveries often prefix sample names with an order code, and IDs must be unique across the catalog and the import — and optionally sets `wildtype` and `derived_from`, which sequencing data never contains;
- may skip the candidate.

The review shows instrument, run, flowcell, lane, read length, and file sizes so the researcher can recognize repeat sequencing, but these details are not stored in the catalog; the workflow derives them from the headers again. Saving runs Task 1's read checks and catalog validation for every accepted candidate and writes new isolates and added read pairs in one catalog update, so a partial import never happens. If another window changed the catalog during review, the decisions are kept, the catalog is reloaded, already-imported files are detected again, and the save is offered again.

The importer never renames, moves, merges, or decompresses delivered files.

## Work

Three slices, each with its tests. Task 1's contract changes they rely on — nullable `wildtype` and allowed mixed trimming — land first.

- [x] **Scan and report:** parse names and headers (index reads, optional lanes, chunks, undetermined and malformed names); stream the sampled records; scan safely; group candidates, read sets, and variants; detect already-imported files; explain every file not imported.
- [ ] **Raw/trimmed suggestions:** read-length evidence, variant comparison, and `ReportStats.json` when present.
- [ ] **Review and save:** import entry, folder selection, scan progress with cancellation, candidate review with new or existing target, the single atomic save, and the retry after a catalog conflict.
- [ ] Build synthetic delivery trees in tests: a BaseSpace-style export with raw and processed copies sharing file names, a library sequenced on two runs, lane-split and lane-merged files, a plain folder of FASTQs, a missing mate, index reads, split chunks, undetermined reads, a directory symlink loop, and a file symlink leaving the folder.
- [ ] Test grouping, suggestions, skipped and unsupported files, review decisions, cancellation, resizing, conflicts, and the single-write save.

## Acceptance

Pointing the importer at an Illumina delivery lists one candidate per sample with its read sets and variants, explains every file it did not import, and saves only the candidates, read sets, and flags the researcher confirmed — as new isolates or added to existing ones. Delivered files are left unchanged.
