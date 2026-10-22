# Import review

The import review proposes isolates from a sequencing delivery's FASTQ files. After the proposed isolates appear, a warning reminds you to set chemistry or choose poly-G On/Off in Edit isolate before running untrimmed reads. This warning is not shown in the folder chooser. Nothing is saved until you choose to save the import. This page explains every row of the review and what saving does.

## Samples

Each sample name found in the FASTQ file names is one proposed isolate. Choose what happens to it:

| Target | Meaning |
|---|---|
| `new isolate` | Creates a new catalog isolate from the sample's chosen read sets. |
| `add to …` | Adds the chosen read sets to an existing isolate, for example a top-up run of a sample imported earlier. Preselected when an isolate's name or ID equals the sample name. |
| `skip` | Imports nothing from this sample. |

For a new isolate you also set its name, ID, wild type, and the isolate it is derived from. The name starts as the sample name, which deliveries often prefix with an order code, so edit it freely. The ID follows the name until you edit it and cannot change after saving. Wild type and the parent isolate are not contained in sequencing data; leave wild type as not recorded if unknown.

## Read sets and copies

A catalog read set represents one library, platform, and layout and can hold multiple R1/R2 file groups across lanes or chunks. This import convenience recognizes Illumina delivery patterns. It saves each sample's selected groups as one new read set, including when adding to an existing isolate. Confirm that the selected groups come from one library; otherwise import separately or add them manually.

Review the prefilled library ID for each sample before saving. A library is one physical DNA preparation: its ID lets duplicate marking group reads across lanes and sequencing runs. Suggestions use the isolate ID and an unused numbered suffix; they do not establish biological identity from filenames or headers. Reuse an existing ID for resequencing of the same library; different preparations need different IDs. Saving confirms the reviewed value.

The review lists file groups by run, lane, and chunk. Raw and provider-processed copies hold the same reads: choose exactly one copy per group. A group row looks like this:

```
Run 24 · HFLOWAAXX · lane 1 · chunk 1: ‹ copy 1 of 2 · 301–301 bp · 2.5 GB · strain-a-ds.e055c2 ›
```

| Part | Meaning |
|---|---|
| Run 24 | The instrument's run number from the read headers. Another row of the same sample with a different run means the library was sequenced again, for example as a top-up. |
| HFLOWAAXX | The flowcell ID from the read headers. It is unique, so the same flowcell means the same sequencing, even when the files lie in different folders. |
| lane 1 | The lane from the file name (`_L001_`). "merged lanes" means the delivery combined all lanes of the flowcell into one file per mate. |
| copy 1 of 2 | This file group exists twice in the delivery and the first copy is chosen. Copies hold the same reads; importing both would count every read twice. |
| 301–301 bp | Shortest and longest read among the first 1,000 or so reads. Raw reads share one length, the number of sequencing cycles; a range such as 69–301 bp suggests trimming. |
| 2.5 GB | Size of both mates on disk, for orientation only: compression changes sizes as much as trimming does. |
| strain-a-ds.e055… | The folder holding this copy. Its name often tells copies apart, for example `strain-a-ds` (raw) and `strain-aadq30ft-ds` (processed by the provider). |

### Choosing a copy

Prefer the untrimmed copy: the workflow applies its own recorded trimming. The full R1 and R2 paths of the selected copy are shown below the list.

| Choice | Meaning |
|---|---|
| `choose one of … copies` | No copy stood out as the only untrimmed one, so you have to choose before saving. |
| `leave out` | Imports nothing from this file group. |

### Already trimmed

Whether the provider already trimmed or filtered the chosen copy. It is preset from the read lengths shown in brackets and resets when you choose another copy; confirm or change it. Demultiplexing can itself trim adapters, so varying lengths are a hint, not proof.

## Reviewing saved read sets

After import, edit read-set metadata under Manage isolates; [Managing isolates](isolates.md) explains the list and form, also available with `?` on non-text rows. A read set's ID stays fixed; its name and file paths may change. Add more file groups or read sets there, including archive-renamed reads that delivery discovery cannot recognize. Library IDs are prefilled as editable suggestions for new sets; existing saved IDs are preserved. Confirm or replace the suggestion before saving. Original read headers are not required for execution.

Record known Illumina chemistry and choose poly-G Auto, On, or Off. Auto resolves for two-colour or four-colour chemistry; one-channel and unknown require an explicit On/Off choice when trimming will run. Review unknown previous processing before execution. Provider-trimmed groups skip further trimming. [Illumina help](illumina.md), available beside general isolate help, explains the chemistry options and poly-G behaviour. A workflow's documentation explains its fixed preprocessing defaults.

The run chooser shows the isolate name once, adds a read-set name only when different, and omits read-set UUIDs and lineage. Equally named sets get short set numbers; an isolate ID appears only to distinguish otherwise identical names. It marks incompatible sets with `!` and shows the highlighted set's reasons below the list. Only explicitly selected compatible sets enter a run snapshot; unselected data is not silently included.

Editing separates isolate details and each read set into bordered sections with short field labels. Long forms scroll with the selected field, keeping the current read-set heading visible even after resizing. Validation shows a short problem preview so fields and the save button remain visible; fix those problems and save again.

## Saving

Saving checks every decision and the chosen read files, then writes all new isolates and added read sets to the catalog in one update, so an import is never saved halfway. Delivered files are never renamed, moved, or changed. If another GenoPilot window changed the catalog meanwhile, your decisions are kept and the catalog is reloaded; save again.
