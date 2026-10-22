# Release 0.0.3

## Goal

Ship the implemented systems check, make sequencing technology explicit on read sets, and improve concurrent catalog use and run-review readability.

## Scope

- [x] [Systems check: hardware facts, resource estimates, timing, and measured rates](done_01_system_check.md) — already implemented.
- [ ] [Sequencing read sets: versioned catalog, workflow selection, snapshots, and preprocessing defaults](02_sequencing_read_sets.md).
- [ ] [Make stale-lock recovery race-free](03_stale_lock_recovery.md).
- [ ] [Reload the isolate catalog after a save conflict](04_catalog_conflict_reload.md).
- [ ] [Shorten run-review summaries](05_run_review_summaries.md).

## Delivery order

1. Keep the completed systems check as the baseline; verify that read-set changes preserve its input-size estimates.
2. Resolve the read-set concept's open decisions and approve its schema/transition before implementation; then follow its task order.
3. Fix stale-lock recovery before changing catalog conflict handling. Both remain independent of the read-set schema and cover tooling setup where it shares locking.
4. Land catalog conflict reload against the resulting catalog contract. Shorten run-review summaries after read-set selection and effective settings are stable.
5. Verify the integrated release and update its changelog and package version at release preparation, not during planning.

## Exclusions

Other items in [later.md](../../later.md), non-Illumina execution, browser follow-ups and restoration of parked browser tests, and a deep performance review are not included.
Archive-renamed reads and legacy-run behavior remain explicit read-set design decisions, not implied support.

## Release completion

- [ ] Every scope item is complete or explicitly moved out.
- [ ] Catalog/run compatibility and migration boundaries are documented and verified; saved evidence is unchanged.
- [ ] Required tests, typechecking, build, and local packaging pass, including Python tests for workflow changes.
- [ ] User/workflow documentation and `CHANGELOG.md` describe delivered behavior.
- [ ] `package.json` matches this release and the packed CLI and workflows are verified before tagging on `main`.
