# Release 0.0.4

## Goal

Download and inspect genomes from the catalog before starting an analysis, then reuse those files in a workflow.

## Scope

- [ ] [Genome sources: NCBI and VEuPathDB behind one interface](01_genome_sources.md).

Status: in progress. Catalog review, metadata-only saving, provider-declared artifact selection, download progress, and provider setup UI are implemented. The packaged Node/Python copy bridge is tested, including cross-root reader protection; workflow configuration/rule integration and authenticated VEuPathDB verification remain open. See the detail file's implementation progress.

## Delivery order

1. Establish the shared catalog entry and required and optional provider methods.
2. Deliver the catalog download and inspection path with NCBI REST; reuse the downloader from Snakemake.
3. Add VEuPathDB and verify its site- and release-specific behavior.
4. Verify both providers end to end before release preparation.

## Exclusions

Downloading single chromosomes is not included: every VEuPathDB organism has whole-genome files per release. Selecting sequences for a run stays in [later.md](../../later.md#sequence-selection-for-inputs). Other items in `later.md` are not included.

## Release completion

- [ ] Every scope item is complete or explicitly moved out.
- [ ] Required tests, typechecking, build, and local packaging pass, including Python tests for workflow changes.
- [ ] User/workflow documentation and `CHANGELOG.md` describe delivered behavior.
- [ ] `package.json` matches this release and the packed CLI and workflows are verified before tagging on `main`.
