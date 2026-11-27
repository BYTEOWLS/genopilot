# Release 0.0.4

## Goal

Download and inspect genomes from the catalog before starting an analysis, then reuse those files in a workflow.

## Scope

- [ ] [Genome sources: NCBI and VEuPathDB behind one interface](01_genome_sources.md).

Status: in progress. Catalog review, metadata-only saving, provider-declared artifact selection, download progress, and provider setup UI are implemented. Both workflows now use the packaged Node/Python bridge, with schema-2 provider references, role-specific cross-root snapshots, protected copying, and provider provenance; the Datasets CLI is removed. Installed-package resolver checks pass without Node on PATH. Both workflows' offline cross-root reuse checks pass through the pinned Snakemake runtime. Same-genome reference/target resolution is serialized by Snakemake without adding a dependency between the jobs. Live NCBI cache-miss downloads and subsequent reuse pass for reference, target, and backbone roles through direct Snakemake. Provider-independent bundled-resolver tests cover the same roles with two synthetic providers. Authenticated VEuPathDB evidence/implementation is the final open implementation step. See the detail file's implementation progress.

## Delivery order

1. Establish the shared catalog entry and required and optional provider methods.
2. Deliver the catalog download and inspection path with NCBI REST; reuse the downloader from Snakemake.
3. Finish direct-Snakemake cache-miss download verification with NCBI.
4. Add VEuPathDB as the final open implementation step, including authenticated evidence and site- and release-specific verification.
5. Run final release verification for both providers before release preparation.

## Exclusions

Downloading single chromosomes is not included: every VEuPathDB organism has whole-genome files per release. Selecting sequences for a run stays in [later.md](../../later.md#sequence-selection-for-inputs). Other items in `later.md` are not included.

## Release completion

- [ ] Every scope item is complete or explicitly moved out.
- [ ] Required tests, typechecking, build, and local packaging pass, including Python tests for workflow changes.
- [ ] User/workflow documentation and `CHANGELOG.md` describe delivered behavior.
- [ ] `package.json` matches this release and the packed CLI and workflows are verified before tagging on `main`.
