# GFF3 ID find-and-replace

## Goal

A simple find-and-replace on the feature IDs of any GFF3 file, run by the application and not bound to Snakemake or to any workflow. Typical inputs are the LiftOn GFF3 of an annotation-transfer run, whose IDs are still the reference's, or any other GFF3 a researcher needs to rename before publication or submission.

It is not a workflow step: no manifest parameter, no rule, and no part of any DAG. A workflow that needs rewritten IDs reads the rewritten file as an imported input.

This is a prerequisite of [INSDC submission preparation](insdc-submission/README.md), which uses it unchanged. Implement it first.

## Contract

- The researcher chooses a GFF3 file, a regular expression, and a replacement. A prefix is the special case `^` → `PREFIX`.
- Only `ID`, `Parent`, and `Derives_from` are rewritten, including every value of a comma-separated list. Every other column and attribute (`Name`, descriptions, `Dbxref`, `product`, `protein_id`, …) stays byte-identical. A feature without an `ID` keeps having none.
- The source file is never modified. The result is a new GFF3, an `id-mapping.tsv` (old ID, new ID, feature type, sequence ID, start), and a small YAML record of the source path and checksum, the expression, the replacement, the application version, and the checksums of both written files.
- A pattern that does not compile is rejected before anything runs. After rewriting, nothing is written when a resulting ID is not a valid GFF3 ID, two distinct IDs collapse into one, or a `Parent` or `Derives_from` no longer resolves.
- Feature IDs only: sequence IDs (column 1) stay unchanged, because they must keep matching the FASTA headers; renaming both together is a separate idea in [`later.md`](../later.md).
- It stays separate from INSDC locus-tag requirements; locus tags belong to the submission workflow.

## Review

Before writing, a screen built on `EditPage` previews the rewrite on the chosen file: a sample of old → new IDs and the number of changed, unchanged, and unmatched IDs. The preview and the rewrite share one TypeScript implementation, so the preview shows exactly what will be written, with JavaScript's regular-expression syntax.

## Code

Parsing and rewriting live in `src/`, independent of any workflow and of Snakemake. It is pure text processing and never runs a bioinformatics tool. The removed `prefix_gff3.py` (in Git history) covered multi-valued parents, discontinuous features, and missing IDs; the new tests cover the same cases.

## Work

- [ ] Kickoff: decide where the command lives (for example a home-screen command or an action on a run's result page), where output is written by default, and confirm the pattern syntax against representative identifier schemes.
- [ ] Add the GFF3 ID rewrite with its `id-mapping.tsv` and provenance record.
- [ ] Add the configuration screen with pattern validation and the preview.
- [ ] Test capture groups, multi-valued parents, discontinuous features, missing IDs, collisions, dangling parents, invalid IDs, unmatched IDs, and that the source stays byte-identical.
