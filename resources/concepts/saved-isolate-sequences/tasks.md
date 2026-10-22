# Saved isolate sequences — tasks

[Concept](concept.md). Steps affect this repository.

## Work

- [ ] Confirm the [read-set contract and transition](../sequencing-read-sets/tasks.md) are implemented; define the versioned sequence extension and its catalog transition without changing read fields or saved run snapshots.
- [ ] Add validated sequence records (kind, origin, and kind-specific fields), contained paths, and symlink-escape checks; show read sets and saved sequences as separate groups in the isolate manager.
- [ ] Implement safe saving and removal primitives, orphan reporting, and integrity display in the isolate manager.
- [ ] Offer **Save to isolate catalog** from the results view for eligible isolate FASTAs, and show there which ones are already saved; the view of consensus [Task 5.2](../completed/consensus/5b-results-view.md) shows only whether a candidate is available.
- [ ] Add tests for saving, invalid candidates, repeated saving, contained paths, symlink escape, and orphan recovery.
