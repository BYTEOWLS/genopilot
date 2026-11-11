# GFF3 find-and-replace

## Outcome

Researchers can rename identifiers and other attribute values in any GFF3 file, with a preview, an ID mapping, and a provenance record, without changing the source or a run's results.

## Scope and contract

- [Concept](../../concepts/annotation-id-rewriting/concept.md) and [tasks](../../concepts/annotation-id-rewriting/tasks.md) own the contract and step order.
- Included: every open task except run-export integration — confirming replacement schemes, the rewrite with its mapping, record, and statistics, the configuration and result screens, the result-page action and home-screen command, tests, and documentation.
- Excluded: the run-export task, which waits for [run export](../../concepts/run-export/concept.md); INSDC submission preparation, which builds on this.
- Independent of the other 0.0.3 items.

## Acceptance criteria

- [ ] All included concept tasks are checked.
- [ ] A rewrite from a finished run writes a new folder under `<run>/derived/`, leaves the source and `results/` byte-identical, and appears in run views as derived.
- [ ] Failure or cancellation leaves no partial folder.
- [ ] `docs/` and `CHANGELOG.md` describe the command and derived files.
