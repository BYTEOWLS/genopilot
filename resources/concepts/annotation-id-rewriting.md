# Post-LiftOn identifier rewriting

## Goal

Replace annotation transfer's provisional prefix-only identifier transformation with a deterministic, researcher-reviewed regular-expression find-and-replace step. A fixed prefix is not enough for every source identifier scheme, and result tables cannot reliably expose final identifiers until this contract exists.

This is a prerequisite of [NCBI submission preparation](ncbi-submission/README.md), which reuses the same step unchanged. Implement it first, in annotation transfer.

## Contract

- The researcher gives a regular expression and a replacement (Python `re` syntax), both saved verbatim in `config.yaml`. An empty expression means no rewriting: as today, the step is not part of the DAG and later stages read the raw LiftOn GFF3.
- A prefix is the special case `^` → `PREFIX`. Existing configurations with `annotation.id_prefix` migrate to that form through an explicit configuration-schema version, and produce byte-identical output.
- Only `ID`, `Parent`, and `Derives_from` are rewritten, including every value of a comma-separated list. Every other column and attribute (`Name`, descriptions, `Dbxref`, `product`, `protein_id`, …) stays byte-identical. A feature without an `ID` keeps having none.
- The raw LiftOn GFF3 is never modified; the step writes a separate file and an `id-mapping.tsv` (old ID, new ID, feature type, sequence ID, start).
- Validation in the application rejects a pattern that does not compile. After rewriting, the step fails on an invalid resulting GFF3 ID, two distinct IDs that collapse into one, and a `Parent` or `Derives_from` that no longer resolves.
- Changing only the expression or replacement reruns rewriting, validation, summaries, and dependent stages, not LiftOn.
- It stays separate from NCBI locus-tag requirements; locus tags belong to the submission workflow.

## Review

Before execution, the configuration screen previews the rewrite on the resolved reference GFF3's IDs, which LiftOn carries over to the target: a sample of old → new IDs and the number of changed, unchanged, and unmatched IDs. The preview uses the same Python semantics as the rule. Either the preview runs the shared script, or the pattern is restricted to syntax that JavaScript and Python interpret identically; decide at kickoff.

Result views and the per-feature transfer TSV distinguish raw LiftOn IDs from final IDs, and provenance records the expression, replacement, and mapping checksum.

## Code

One script in `workflows/shared/scripts/` replaces `prefix_gff3.py`, keeping its attribute allowlist and its tests for multi-valued parents, discontinuous features, and missing IDs. It is placed in shared code because NCBI submission is a concrete second use.

The manifest parameter `annotation-id-regex` ("Annotation ID find (regex)") already exists, but nothing reads it yet. Until this task lands it must be hidden or marked as a placeholder, and `annotation-id-prefix` becomes the replacement field.

## Work

- [ ] Kickoff: choose the preview mechanism and confirm the pattern syntax against representative identifier schemes.
- [ ] Hide or mark the unused `annotation-id-regex` parameter until the step exists.
- [ ] Replace `prefix_gff3.py` with the shared rewrite script and its `id-mapping.tsv`.
- [ ] Add the configuration fields, schema version, and migration from `annotation.id_prefix`.
- [ ] Add the preview and pattern validation to the configuration screen.
- [ ] Show raw and final IDs in the result views and transfer TSV; record the rewrite in provenance.
- [ ] Test the migration's byte-identical output, capture groups, collisions, dangling parents, invalid IDs, unmatched IDs, and a rewrite-only rerun that reuses LiftOn's output.
