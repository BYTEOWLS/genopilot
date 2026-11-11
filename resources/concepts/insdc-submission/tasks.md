# INSDC submission preparation — tasks

[Concept](concept.md). Steps affect this repository.

## Work

- [ ] Kickoff: confirm the [GFF3 find-and-replace](../annotation-id-rewriting/concept.md) is done, choose the first node, resolve the open questions, and record the answers in this file.
- [ ] Add the `insdc-submission` manifest, parameters, configuration schema, and form, with the node as an explicit choice.
- [ ] Implement FASTA trimming with GFF3 coordinate shifting and the short/N-rich report.
- [ ] Implement locus-tag, transcript-ID, and protein-ID assignment with the ID mapping.
- [ ] Implement the uncertain-feature report, its saved decisions, and the rerun from that point.
- [ ] Pin the first node's validator, run it, and parse its reports into a versioned summary.
- [ ] Build the package with checksums, provenance, and the manual checklist; show it in the TUI.
- [ ] Prepare isolate reads after the [read-set contract](../completed/sequencing-read-sets/tasks.md) is implemented: snapshot selected read sets, validate node-specific platform/layout mappings, and add only submission metadata, the sheet or manifests, checksummed file list, processing-state and ambiguous-base report, and upload checklist.
- [ ] Add synthetic fixtures and tests: leading/trailing `N`, a feature in a trimmed end, `N` runs around the gap threshold, a CDS over a gap, missing products, prokaryotic and eukaryotic fixtures, a sequence with its own location and genetic code, both locus-tag modes, duplicate generated locus tags, and a decision-only rerun. Gate real validator runs like the Conda integration tests.
