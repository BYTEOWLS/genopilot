# Release 0.0.4

## Goal

Let workflows use genomes from VEuPathDB sites, such as FungiDB, as well as from NCBI, with each remote source behind one shared interface.

## Scope

- [ ] [Genome sources: NCBI and VEuPathDB behind one interface](01_genome_sources.md).

## Delivery order

1. Move NCBI behind the genome-source interface without changing behavior.
2. Generalize the catalog, workflow configuration, key store, cache discovery, and resolver.
3. Add VEuPathDB.
4. Verify the integrated release with a real VEuPathDB key and update its changelog and package version at release preparation, not during planning.

## Exclusions

Downloading single chromosomes is not included: every VEuPathDB organism has whole-genome files per release. Selecting sequences for a run stays in [later.md](../../later.md#sequence-selection-for-inputs). Other items in `later.md` are not included.

## Release completion

- [ ] Every scope item is complete or explicitly moved out.
- [ ] Required tests, typechecking, build, and local packaging pass, including Python tests for workflow changes.
- [ ] User/workflow documentation and `CHANGELOG.md` describe delivered behavior.
- [ ] `package.json` matches this release and the packed CLI and workflows are verified before tagging on `main`.
