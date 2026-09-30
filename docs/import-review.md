# Import review

The import review proposes isolates from a sequencing delivery's FASTQ files. Nothing is saved until you choose to save the import. This page explains every row of the review and what saving does.

## Samples

Each sample name found in the FASTQ file names is one proposed isolate. Choose what happens to it:

| Target | Meaning |
|---|---|
| `new isolate` | Creates a new catalog isolate from the sample's chosen read sets. |
| `add to …` | Adds the chosen read sets to an existing isolate, for example a top-up run of a sample imported earlier. Preselected when an isolate's name or ID equals the sample name. |
| `skip` | Imports nothing from this sample. |

For a new isolate you also set its name, ID, wild type, and the isolate it is derived from. The name starts as the sample name, which deliveries often prefix with an order code, so edit it freely. The ID follows the name until you edit it and cannot change after saving. Wild type and the parent isolate are not contained in sequencing data; leave wild type as not recorded if unknown.

## Read sets and copies

A read set is the reads of one sample from one lane of one sequencing run. Separate read sets hold different reads that add up, so a sample usually keeps all of them. A read set can exist more than once in a delivery, for example as raw reads and as a copy the provider trimmed or filtered. Copies hold the same reads, so choose exactly one per read set. A read-set row looks like this:

```
Run 24 · HFLOWAAXX · lane 1: ‹ copy 1 of 2 · 301–301 bp · 2.5 GB · strain-a-ds.e055c2 ›
```

| Part | Meaning |
|---|---|
| Run 24 | The instrument's run number from the read headers. Another row of the same sample with a different run means the library was sequenced again, for example as a top-up. |
| HFLOWAAXX | The flowcell ID from the read headers. It is unique, so the same flowcell means the same sequencing, even when the files lie in different folders. |
| lane 1 | The lane from the file name (`_L001_`). "merged lanes" means the delivery combined all lanes of the flowcell into one file per mate. |
| copy 1 of 2 | This read set exists twice in the delivery and the first copy is chosen. Copies hold the same reads; importing both would count every read twice. |
| 301–301 bp | Shortest and longest read among the first 1,000 or so reads. Raw reads share one length, the number of sequencing cycles; a range such as 69–301 bp suggests trimming. |
| 2.5 GB | Size of both mates on disk, for orientation only: compression changes sizes as much as trimming does. |
| strain-a-ds.e055… | The folder holding this copy. Its name often tells copies apart, for example `strain-a-ds` (raw) and `strain-aadq30ft-ds` (processed by the provider). |

### Choosing a copy

Prefer the untrimmed copy: the workflow applies its own recorded trimming. The full R1 and R2 paths of the selected copy are shown below the list.

| Choice | Meaning |
|---|---|
| `choose one of … copies` | No copy stood out as the only untrimmed one, so you have to choose before saving. |
| `leave out` | Imports nothing from this read set. |

### Already trimmed

Whether the provider already trimmed or filtered the chosen copy. It is preset from the read lengths shown in brackets and resets when you choose another copy; confirm or change it. Demultiplexing can itself trim adapters, so varying lengths are a hint, not proof.

## Saving

Saving checks every decision and the chosen read files, then writes all new isolates and added read sets to the catalog in one update, so an import is never saved halfway. Delivered files are never renamed, moved, or changed. If another GenoPilot window changed the catalog meanwhile, your decisions are kept and the catalog is reloaded; save again.
