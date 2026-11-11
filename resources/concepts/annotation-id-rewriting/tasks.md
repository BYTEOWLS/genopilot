# GFF3 find-and-replace — tasks

[Concept](concept.md). Steps affect this repository.

## Work

- [x] Kickoff: entry points (result-page action and home-screen command), default output folders, and statistics decided in the [concept](concept.md#placement-and-output).
- [ ] Confirm literal and regular-expression replacements against representative identifier schemes, such as a renamed prefix and a prefix with a capture group.
- [ ] Add the GFF3 find-and-replace in `src/` with its `id-mapping.tsv`, provenance record, and statistics, run in a cancellable worker and written atomically.
- [ ] Add the configuration screen with the regular-expression switch, pattern validation, the preview, and the result view with the statistics.
- [ ] Add the result-page action for finished runs' `gff3` manifest artifacts, writing to `<run>/derived/`, and the home-screen command for any GFF3 file; list derived rewrites in run views and mark outdated ones.
- [ ] Test literal and regular-expression replacement, capture groups, escaped characters in values, multi-valued attributes, untouched columns, comments, and `##FASTA` sections, discontinuous features, missing IDs, empty values, collisions, dangling parents, invalid IDs, unmatched IDs, the former ID appended to a renamed gene's existing or missing `Alias` and not repeated on a second rewrite, no alias on unchanged genes or non-gene features, literal `$` sequences in a literal replacement, rejected empty searches and empty-matching patterns, reserved characters in the replacement, unchanged values keeping their original escaping, CRLF and a missing final newline, statistics in the record equal to the preview's, a new folder per rewrite including same-millisecond collisions through an injected clock, chained rewrites, no partial folder after failure or cancellation, cancellation terminating a worker that never finishes (an injected stub, awaited on observable state, never a real slow pattern or timer), outdated marking, and that the source and the run's `results/` stay byte-identical.
- [ ] Include derived rewrites in [run export](../run-export/concept.md) when that is implemented.
- [ ] Document the command and derived files in `docs/` (including `run-results.md`) and add a `CHANGELOG.md` entry.
