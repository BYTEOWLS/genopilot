# Reference-guided cohort consensus — tasks

[Concept](concept.md). Steps affect this repository.

## Ordered work

- [x] 1. [Manage isolates](1-manage-isolates.md)
- [x] 1b. [Import isolates from an Illumina delivery](1b-import-illumina-isolates.md)
- [x] 2. [Manage accessions](2-manage-accessions.md)
- [x] 3. [Workflow configuration and review](3-workflow-configuration-and-review.md)
- [x] 4.1. [Per-isolate processing](4a-per-isolate-processing.md)
- [x] 4.2. [Cohort support aggregation](4b-cohort-support-aggregation.md)
- [x] 4.3. [Combined consensus generation](4c-combined-consensus-generation.md)
- [x] 5.1. [Cohort iterations](5a-cohort-iterations.md)
- [x] 5.2. [Results view](5b-results-view.md)
- [x] 5.3. [Review and rerun](5c-review-and-rerun.md)

Saving isolate FASTAs to the isolate catalog, once planned as Task 5.4, is its own concept: [saved isolate sequences](../../saved-isolate-sequences/concept.md).

Tasks 1 and 2 may be implemented independently. Task 1b builds on Task 1 and is optional for the later tasks. Task 3 depends on both catalogs. Execution tasks 4.1–4.3 are sequential Snakemake targets but remain separate vertical slices because each produces independently testable scientific artifacts. Tasks 5.1–5.3 depend on their persisted result contracts and build on each other.
