# Release 0.0.3

## Goal

Ship the implemented systems check, make sequencing technology explicit on read sets, let reference-consensus ties be settled, and add a GFF3 find-and-replace.

## Scope

- [x] [Systems check: hardware facts, resource estimates, timing, and measured rates](done_01_system_check.md) — already implemented.
- [x] [Sequencing read sets: catalog, workflow selection, snapshots, and preprocessing defaults](done_02_sequencing_read_sets.md).
- [x] [Settle reference-consensus ties](done_06_consensus_tie_handling.md).
- [ ] [GFF3 find-and-replace](07_gff3_find_and_replace.md).

Items 03–05 (race-free stale-lock recovery, catalog reload after a save conflict, shorter run-review summaries) moved to the [backlog](../../backlog/).

## Delivery order

1. Keep the completed systems check as the baseline; verify that read-set changes preserve its input-size estimates.
2. Deliver read sets in concept task order, preserving schema versions at `1` and rejecting old structures without migration or legacy-run compatibility.
3. Settle consensus ties independently of the items above.
4. Add the GFF3 find-and-replace in concept task order, independently of the items above.
5. Verify the integrated release and update its changelog and package version at release preparation, not during planning.

## Exclusions

Other items in [later.md](../../later.md), non-Illumina execution, browser follow-ups and restoration of parked browser tests, and a deep performance review are not included.
Archive-renamed Illumina reads are included through explicit metadata. Catalog migration and legacy-run compatibility are excluded; existing evidence remains untouched.

## Release completion

- [ ] Every scope item is complete or explicitly moved out.
- [ ] Catalog/run compatibility and migration boundaries are documented and verified; saved evidence is unchanged.
- [ ] Required tests, typechecking, build, and local packaging pass, including Python tests for workflow changes.
- [ ] User/workflow documentation and `CHANGELOG.md` describe delivered behavior.
- [ ] `package.json` matches this release and the packed CLI and workflows are verified before tagging on `main`.
