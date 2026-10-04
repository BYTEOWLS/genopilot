# GFF3 find-and-replace

## Goal

A find-and-replace over the attributes of any GFF3 file, run by the application and not bound to Snakemake or to any workflow. Typical inputs are the LiftOn GFF3 of an annotation-transfer run, whose IDs are still the reference's, or any other GFF3 a researcher needs to rename before publication or submission. Renaming IDs is the main use, but identifiers also appear in `Name`, `locus_tag`, `product`, and other attributes, so the replacement applies to all of them, as a text editor's would, while keeping the file valid.

It is not a workflow step: no manifest parameter, no rule, and no part of any DAG. A workflow that needs rewritten IDs reads the rewritten file as an imported input.

This is a prerequisite of [INSDC submission preparation](insdc-submission/README.md), which uses it unchanged. Implement it first.

## Contract

- The researcher chooses a GFF3 file, a search text, and a replacement. The search is literal and case-sensitive and replaces every occurrence. A switch turns it into a regular expression, with JavaScript's syntax and `$1`-style capture groups in the replacement; a prefix is then the special case `^` → `PREFIX`.
- The replacement applies to every attribute value in column 9, including each value of a comma-separated list, matched on the decoded value and written back with GFF3's escaping. Attribute names are never changed.
- The first eight columns, comments, directives, and an embedded `##FASTA` section stay byte-identical. Sequence IDs (column 1) therefore keep matching the FASTA headers; renaming both together is a separate idea in [`later.md`](../later.md#sequence-id-renaming).
- A gene whose `ID` changes keeps its former ID in the file: after the replacement, the old ID is appended to its `Alias`, GFF3's reserved attribute for secondary names, after the values already there and only when not yet among them. The appended value is not itself searched. Repeated rewrites therefore accumulate a gene's history, and a transferred gene keeps the reference's gene ID it was lifted from. Genes are the features of type `gene` and `pseudogene`; other features get no alias, because their old IDs are in `id-mapping.tsv`.
- The source file is never modified. The result is a new GFF3, an `id-mapping.tsv` (old ID, new ID, feature type, sequence ID, start) for every changed `ID`, and a small YAML record of the source path and checksum, the search text, the replacement, whether it was a regular expression, the application version, and the checksums of both written files.
- A regular expression that does not compile is rejected before anything runs. After replacing, nothing is written when an attribute value becomes empty, a resulting ID is not a valid GFF3 ID, two distinct IDs collapse into one, or a `Parent` or `Derives_from` no longer resolves. A replacement applied to all values renames a parent and its references alike, so these checks catch only patterns that treat them differently.
- It stays separate from INSDC locus-tag requirements; locus tags belong to the submission workflow.

## Review

Before writing, a screen built on `EditPage` previews the replacement on the chosen file: the number of changed values per attribute, a sample of old → new values for each, the number of unchanged and unmatched IDs, and the number of aliases it will add. Replacing in free text, such as a `product` description, is intended but easy to overlook, so the per-attribute counts make it visible. The preview and the rewrite share one TypeScript implementation, so the preview shows exactly what will be written.

## Code

Parsing and rewriting live in `src/`, independent of any workflow and of Snakemake. It is pure text processing and never runs a bioinformatics tool. The removed `prefix_gff3.py` (in Git history) covered multi-valued parents, discontinuous features, and missing IDs; the new tests cover the same cases.

## Work

- [ ] Kickoff: decide where the command lives (for example a home-screen command or an action on a run's result page), where output is written by default, and confirm literal and regular-expression replacements against representative identifier schemes.
- [ ] Add the GFF3 find-and-replace with its `id-mapping.tsv` and provenance record.
- [ ] Add the configuration screen with the regular-expression switch, pattern validation, and the preview.
- [ ] Test literal and regular-expression replacement, capture groups, escaped characters in values, multi-valued attributes, untouched columns, comments, and `##FASTA` sections, discontinuous features, missing IDs, empty values, collisions, dangling parents, invalid IDs, unmatched IDs, the former ID appended to a renamed gene's existing or missing `Alias` and not repeated on a second rewrite, no alias on unchanged genes or non-gene features, and that the source stays byte-identical.
