# Release 0.0.4

## Goal

Download and inspect genomes from the catalog before starting an analysis, then reuse those files in a workflow.

## Scope

- [x] [Genome sources: NCBI and VEuPathDB behind one interface](done_01_genome_sources.md).

Status: in progress. Catalog review, metadata-only saving, provider-declared artifact selection, download progress, and provider setup UI are implemented. Both workflows now use the packaged Node/Python bridge, with schema-2 provider references, role-specific cross-root snapshots, protected copying, and provider provenance; the Datasets CLI is removed. Installed-package resolver checks pass without Node on PATH. Both workflows' offline cross-root reuse checks pass through the pinned Snakemake runtime. Same-genome reference/target resolution is serialized by Snakemake without adding a dependency between the jobs. Live NCBI cache-miss downloads and subsequent reuse pass for reference, target, and backbone roles through direct Snakemake. Provider-independent bundled-resolver tests cover the same roles with two synthetic providers. VEuPathDB catalog discovery, supported-site selection, all five whole-genome artifacts, and authenticated current/historical downloads are implemented. The packaged resolver and pinned-Snakemake offline reuse work for both providers. Both guided workflow forms now use selection-only catalog fields and preserve provider references through previous-run prefill, review, and saving. Downloaded genomic FASTA is required before selection, with all role-required files in one verified copy before saving; typed workflow identifiers are removed. Required verification passes. Task 01 is complete at the researcher’s request, without repeating visual browser smoke (browser-specific tests remain parked); release preparation is tracked below. See the detail file's implementation progress.

NCBI also exposes independently selectable protein FASTA, with verified protein-only downloads, cache reuse, and actionable missing-protein failures. A standalone developer script now compares local reference downloads without dependencies or a database. See the detail file's follow-up records.

## Delivery order

1. Establish the shared catalog entry and required and optional provider methods.
2. Deliver the catalog download and inspection path with NCBI REST; reuse the downloader from Snakemake.
3. Finish direct-Snakemake cache-miss download verification with NCBI.
4. VEuPathDB's provider and guided workflow handoff are implemented: site-scoped search, whole-genome artifacts, full catalog selection, snapshotted provider references, and authenticated current/historical verification. Shared artifact selection is inline for every provider.
5. Shared Assembly/Genome statistics fields and provider-specific details are implemented for both providers; existing metadata/cache records remain compatible. VEuPathDB review now defaults mitochondrial inclusion off, with separate filtered identities, genomic-pair classification, original evidence, and recorded exclusions.
6. Provider help is packaged and available from global Help and contextual provider/catalog actions, including key setup, website links, and exact discovery/search scope. The registry is exported as `accessionSources`.
7. Run final release verification for both providers before release preparation.

## Exclusions

Downloading single chromosomes is not included: every VEuPathDB organism has whole-genome files per release. VEuPathDB's provider-specific mitochondrial exclusion is included; arbitrary sequence selection for a run stays in [later.md](../../later.md#sequence-selection-for-inputs). Other items in `later.md` are not included.

## Release completion

- [x] Every scope item is complete or explicitly moved out.
- [x] Required tests, typechecking, build, and local packaging pass, including Python tests for workflow changes.
- [x] User/workflow documentation and `CHANGELOG.md` describe delivered behavior.
- [ ] `package.json` matches this release and the packed CLI and workflows are verified before tagging on `main`.
