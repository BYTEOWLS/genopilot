# GFF3 find-and-replace

## Goal

A find-and-replace over the attributes of any GFF3 file, run by the application and not bound to Snakemake or to any workflow. Typical inputs are the LiftOn GFF3 of an annotation-transfer run, whose IDs are still the reference's, or any other GFF3 a researcher needs to rename before publication or submission. Renaming IDs is the main use, but identifiers also appear in `Name`, `locus_tag`, `product`, and other attributes, so the researcher chooses which attributes the replacement applies to, up to all of them as a text editor's would, while keeping the file valid.

It is not a workflow step: no manifest parameter, no rule, and no part of any DAG. A workflow that needs rewritten IDs reads the rewritten file as an imported input.

This is a prerequisite of [INSDC submission preparation](../../insdc-submission/concept.md), which uses it unchanged. Implement it first.

## Contract

- The researcher chooses a GFF3 file, a search text, and a replacement. The search is literal and case-sensitive and replaces every occurrence; the replacement is inserted exactly as typed, so `$` has no special meaning. A switch turns it into a regular expression, with JavaScript's syntax and `$1`-style capture groups in the replacement; a prefix is then the special case `^` → `PREFIX`. An empty search text is rejected, and so is a regular expression that matches the empty string anywhere other than at an anchor, such as `x*`.
- A scope chooses the attributes searched: one checkbox each for IDs and references (`ID`, `Parent`, `Derives_from`, always together), `Name`, `locus_tag`, `gene`, `product`, `Note`, `Alias`, and `Dbxref`, plus **All attributes**, which searches every attribute without guard rails. The default is IDs and references, `Name`, and `locus_tag`. Other attributes are searched only under All.
- The replacement applies to every value of a selected attribute in column 9, including each value of a comma-separated list, matched on the decoded value. Attribute names are never changed. Only changed values are written back with GFF3's escaping, and reserved characters (`,`, `;`, `=`, `&`, tab) from the replacement are always percent-encoded, so a `,` never splits a value. Unchanged values and attributes stay byte-identical, including their original escaping.
- The first eight columns, comments, directives, line endings, a missing final newline, and an embedded `##FASTA` section stay byte-identical. Sequence IDs (column 1) therefore keep matching the FASTA headers; renaming both together is a separate idea in [`later.md`](../../../later.md#sequence-id-renaming).
- A gene whose `ID` changes keeps its former ID in the file: after the replacement, the old ID is appended to its `Alias`, GFF3's reserved attribute for secondary names, after the values already there and only when not yet among them. The appended value is not itself searched, also under All; earlier `Alias` values are searched only when `Alias` or All is selected. Repeated rewrites therefore accumulate a gene's history, and a transferred gene keeps the reference's gene ID it was lifted from. Genes are the features of type `gene` and `pseudogene`; other features get no alias, because their old IDs are in `id-mapping.tsv`.
- The source file is never modified. The result is a new GFF3 with the source's file name, an `id-mapping.tsv` (old ID, new ID, feature type, sequence ID, start) with one row per changed `ID`, and a `replace.yaml` record of the source path and SHA-256 checksum, the search text, the replacement, whether it was a regular expression, the scope, the application version, the checksums of both written files, and the statistics below.
- Statistics: the total number of replacements (matches; a zero-width match such as `^` counts once per value), the number of changed values per attribute, the number of IDs that changed, matched without changing, and did not match, and the number of aliases added. The preview shows the same counts, and a result view shows them again after writing.
- A regular expression that does not compile is rejected before anything runs. After replacing, nothing is written when an attribute value becomes empty, a resulting ID is empty or contains whitespace or control characters, two distinct IDs collapse into one (also a renamed ID meeting an unchanged one), or a `Parent` or `Derives_from` that resolved before no longer resolves. Lines sharing one `ID`, such as a discontinuous CDS, are one feature, and its mapping row uses the first line's start. References already dangling in the source are counted, not rejected. `ID`, `Parent`, and `Derives_from` are always searched together, so a reference follows its ID; the reference check is a safety net.
- It stays separate from INSDC locus-tag requirements; locus tags belong to the submission workflow.
- One search and replacement per rewrite; chained rewrites apply several. Compressed GFF3 is not read.

## Placement and output

- Two entry points open the same screen: `g` on a finished run's result page, which chooses one of its existing manifest artifacts of type `gff3` or current rewrites and fixes it as the source, and a general home-screen command for any GFF3 file. Shared code never names a workflow's GFF3.
- Every rewrite writes a new folder and never overwrites an earlier one. Started from a run, the folder is `<run>/derived/gff3-replace-<timestamp>/`: inside the run, so it travels with it, but outside `results/`, so Snakemake never sees it and the run's own outputs stay unchanged as evidence. A rewrite of a file in a run's `derived/` also writes there, and its record names the source folder. A file chosen from the home screen that lies inside a run, found by the run's `config.yaml` in a folder above it, is treated as started from that run. Started from any other file, the default is a folder next to the source; the researcher can change it with the file browser. The timestamp has millisecond precision, and a counter is appended if the folder still exists.
- Output is written into a temporary folder and renamed when complete, so a failure or cancellation leaves no partial folder.
- The result page lists rewrites in a Derived files section, separate from the run's generated, imported, and cached files; the run's artifact index is not changed. A rewrite whose recorded source checksum no longer matches the source's recorded checksum — in `artifacts.yaml`, or in the earlier rewrite's `replace.yaml` — is marked outdated; nothing is re-hashed to show the list.
- Deleting a run deletes its `derived/` folder with it.
- [Run export](../../run-export/concept.md) includes each derived rewrite's YAML record and `id-mapping.tsv` and lists its GFF3 with its checksum.

## Review

The screen shows an info note that the sequence IDs in column 1 must match the FASTA headers and are therefore never changed; [`docs/gff3-find-and-replace.md`](../../../../docs/gff3-find-and-replace.md), the screen's help, explains the same with an example.

Before writing, a screen built on `EditPage` previews the replacement on the chosen file: the number of changed values per attribute, a sample of old → new values for each, the number of unchanged and unmatched IDs, and the number of aliases it will add. Replacing in free text, such as a `product` description, is intended but easy to overlook, so the per-attribute counts make it visible. The preview and the rewrite share one TypeScript implementation, so the preview shows exactly what will be written; writing repeats the pass and refuses when the source checksum differs from the preview's. After writing, a result view shows the statistics and the written paths.

It is application post-processing rather than a Snakemake rule because it is a fast single pass over text, needs an interactive preview Snakemake cannot provide, and must not turn every pattern change into a configuration change and rerun.

## Code

Parsing and rewriting live in `src/`, independent of any workflow and of Snakemake. It is pure text processing and never runs a bioinformatics tool. The preview and the rewrite run in a `worker_thread`, so a slow regular expression never blocks the interface and cancellation terminates the worker. The worker is its own esbuild entry, `dist/gff3-replace-worker.js`, checked in the packed artifact. The removed `prefix_gff3.py` (in Git history) covered multi-valued parents, discontinuous features, and missing IDs; the new tests cover the same cases.

## Work

See the [ordered tasks](tasks.md).
