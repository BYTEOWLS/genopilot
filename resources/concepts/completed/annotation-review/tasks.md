# Annotation review — tasks

[Concept](concept.md). Steps affect this repository.

## Work

1. [x] Count the target's bases that are not A, C, G, or T in input validation and warn about them.
2. [x] Rating in the summary step: the threshold parameter, the target FASTA as input, the new columns, the metrics, and the BED, with tests on synthetic FASTA and GFF3 rows for every category and reason, and for the empty columns on additional copies and non-coding features.
3. [x] The *Proteins* result tab with its gene detail, documented in the annotation transfer's `README.md` and `results.md`.
4. [x] Review view: the view builder with the verified target, the tracks, item cards, presets, and synchronized navigation from the review list, the `## Proteins genome review` guide section, and fixture tests for the builder (track order, missing candidate files, checksum mismatch, item cards).
5. [x] The consensus suggestion with the warning about unresolved positions in the reference consensus's `README.md` and `results.md`, and on its result page's Overview.

The verdicts, the candidate-model choice, and the reviewed GFF3 continue in the [annotation review decision](../../annotation-review-decision/concept.md).
