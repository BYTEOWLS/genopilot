# Reference-guided cohort consensus

This directory is the ordered plan for building a T2T-backed cohort consensus from one assembly backbone and reusable paired-read isolates. Comparison and later annotation work will receive separate concept directories when their contracts are planned.

The first unticked item is the default next task unless its file states another dependency. Keep completed items and task files as the implementation record.

## Agreed processing model

1. Process every selected isolate independently and preserve its alignment, callable mask, normalized calls, metrics, and reference-guided FASTA.
2. Combine callable isolate alleles with one vote from the T2T backbone into a per-position support table.
3. Produce a cohort consensus using the researcher-selected voting method: strict majority or plurality.
4. Present ties and other unresolved evidence, save isolate-exclusion decisions, and rerun only aggregation and dependent outputs.

The cohort consensus is assembled from normalized calls and callable masks, not by comparing FASTA text directly. An uncallable isolate never receives a vote merely because its generated FASTA retained the backbone base.

## Available foundations

These are already implemented by the annotation-transfer work and should be reused rather than rebuilt:

- [x] Packaged workflow discovery by stable ID and versioned manifests.
- [x] Generic parameter-driven configuration screens, local path entry, and file chooser.
- [x] Versioned configuration validation, isolated run workspaces, and dry-run review.
- [x] Local and versioned NCBI assembly resolution with checksum-verified reuse/refresh caching.
- [x] Managed Snakemake execution, structured events, complete logs, provenance, and result loading.
- [x] Welcome-screen entries for **Manage isolates** and **Manage NCBI accessions**, backed by the isolate catalog (Task 1) and the accession catalog (Task 2).

## Ordered work

- [x] 1. [Manage isolates](1-manage-isolates.md)
- [x] 1b. [Import isolates from an Illumina delivery](1b-import-illumina-isolates.md)
- [x] 2. [Manage accessions](2-manage-accessions.md)
- [ ] 3. [Workflow configuration and review](3-workflow-configuration-and-review.md)
- [ ] 4.1. [Per-isolate processing](4a-per-isolate-processing.md)
- [ ] 4.2. [Cohort support aggregation](4b-cohort-support-aggregation.md)
- [ ] 4.3. [Combined consensus generation](4c-combined-consensus-generation.md)
- [ ] 5. [Results and post-processing](5-results-and-post-processing.md)

Tasks 1 and 2 may be implemented independently. Task 1b builds on Task 1 and is optional for the later tasks. Task 3 depends on both catalogs. Execution tasks 4.1–4.3 are sequential Snakemake targets but remain separate vertical slices because each produces independently testable scientific artifacts. Task 5 depends on their persisted result contracts.

## Terminology

- **Backbone**: the assembly FASTA that supplies coordinates, sequence structure, and one cohort vote; typically the T2T assembly.
- **Legacy reference**: an older assembly, such as a Sanger-era reference, used later for comparison or annotation transfer; it is not a cohort vote unless a future design explicitly says otherwise.
- **Isolate**: a biological sample with reusable metadata and one or more paired R1/R2 read sets.
- **Read pair**: one R1/R2 FASTQ pair, typically one lane of one sequencing run; a library sequenced several times has several pairs whose reads add up.
- **Isolate genome**: a reference-guided FASTA generated for one isolate from its calls against a particular backbone.
- **Cohort consensus**: the potentially mosaic sequence selected from the backbone and callable isolate votes. It is not claimed to be the genome of one biological individual.
