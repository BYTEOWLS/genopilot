# GFF3 find-and-replace — tasks

[Concept](concept.md). Steps affect this repository.

## Work

- [ ] Kickoff: decide where the command lives (for example a home-screen command or an action on a run's result page), where output is written by default, and confirm literal and regular-expression replacements against representative identifier schemes.
- [ ] Add the GFF3 find-and-replace with its `id-mapping.tsv` and provenance record.
- [ ] Add the configuration screen with the regular-expression switch, pattern validation, and the preview.
- [ ] Test literal and regular-expression replacement, capture groups, escaped characters in values, multi-valued attributes, untouched columns, comments, and `##FASTA` sections, discontinuous features, missing IDs, empty values, collisions, dangling parents, invalid IDs, unmatched IDs, the former ID appended to a renamed gene's existing or missing `Alias` and not repeated on a second rewrite, no alias on unchanged genes or non-gene features, and that the source stays byte-identical.
