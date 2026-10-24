# Sequencing read sets

## Outcome

Separate isolate identity from sequencing inputs, with explicit read-set selection and reproducible Illumina execution.

## Scope and contract

Delivered all ten [tasks](../../concepts/completed/sequencing-read-sets/tasks.md), in order. The [concept](../../concepts/completed/sequencing-read-sets/concept.md) owns the behavior and separation of concerns; tasks record the affected contracts and verification.

Execution remains paired-end Illumina only, including archive-renamed reads with explicit metadata. Catalog migration and legacy-run compatibility are not required. Additional platforms, hybrid calling, and speculative plugin frameworks are excluded; keep technology-specific helpers separate from general catalog/run handling.

Schema versions remain at `1`; old structures are rejected directly, with no migration or compatibility layer.

## Acceptance criteria

- [x] Read sets support multiple file groups and shared, user-confirmed library identity; incompatible catalogs/runs are rejected without deleting evidence.
- [x] Explicit selection and immutable snapshots preserve files, metadata, effective settings, and provenance independently of catalog edits.
- [x] Archive-renamed Illumina reads use supplied metadata with independent FASTQ/pairing checks and conflict detection.
- [x] Approved poly-G Auto / On / Off behavior, provider-trimmed skips, unknown-processing review, and fixed other Illumina defaults are implemented.
- [x] Documentation includes a hypothetical technology-extension example; required verification passes and systems-check input-size estimates remain correct.
