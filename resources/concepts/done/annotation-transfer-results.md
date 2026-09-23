# Annotation-transfer results: design and contracts

## Purpose

This document records how annotation-transfer results are produced and presented: the persisted contracts, the design decisions, and the implemented slices. All planned slices are implemented; it is kept for reference.

Code and file paths below are relative to the repository root. Remaining work is tracked in [`tasks.md`](../../../tasks.md).

## Design dogma

Keep the implementation deliberately small and changeable:

- Snakemake produces and persists scientific results.
- TypeScript validates and presents persisted results; it does not recalculate them.
- Prefer LiftOn's structured reports over custom reconstruction.
- Use the raw LiftOn GFF3 only for details that LiftOn does not aggregate, such as coordinates and model attributes.
- Keep a generic result-page shell, but bind scientific parsing and presentation to a supported workflow ID and workflow version.
- Do not build a dynamic plugin system until another real workflow requires one.
- Generalize or decouple only after a concrete second use demonstrates the boundary.

## Implemented state

The annotation-transfer workflow now ends with:

```text
validate transferred GFF3
    -> summarize_annotation_transfer
        -> results/feature-transfer.tsv
        -> results/metrics.json
        -> results/summary.json
```

Implemented files:

```text
workflows/shared/scripts/collect_transfer_metrics.py
workflows/shared/rules/summarize_results.smk
workflows/annotation-transfer/Snakefile
workflows/annotation-transfer/manifest.yaml
```

Tests:

```text
tests/workflows/annotation_transfer/test_collect_transfer_metrics.py
tests/workflows/annotation_transfer/test_snakefile_direct_execution.py
tests/workflows/annotation-transfer/resources.test.ts
```

The summarization rule is registered under manifest stage `summarize-results`, and all three generated reports are targets of `rule all`.

## Authoritative evidence

Transfer counts and mapping status come from pinned LiftOn 1.0.13 outputs:

```text
results/annotation/lifton_output/run_manifest.json
results/annotation/lifton_output/stats/completeness_by_feature_type.txt
results/annotation/lifton_output/stats/mapped_feature.txt
results/annotation/lifton_output/stats/unmapped_features.txt
results/annotation/lifton_output/stats/extra_copy_features.txt
results/annotation/lifton_output/intermediate_files/auto_feature_types.txt
```

The collector requires and cross-checks these files. It fails rather than silently broadening the selected feature set or replacing missing LiftOn results with custom guesses.

The raw GFF3 is used only to enrich and verify those results:

```text
results/annotation/lifton.raw.gff3
```

It supplies:

- target coordinates and strand;
- raw target IDs;
- transfer method;
- `dna_identity` and `protein_identity` attributes;
- LiftOn mutation classifications.

The human-readable LiftOn summary and console logs are not parsed.

## Persisted result contracts

All contracts are version 1. The TypeScript reader is described in Slice 3.

### `results/feature-transfer.tsv`

One row is written for every selected reference feature and every emitted target copy. Unmapped reference features retain one row with empty target fields.

Columns:

```text
reference_id
feature_type
lifton_category
status
copy_number
target_id
target_seqid
target_start
target_end
target_strand
transfer_method
minimum_dna_identity
minimum_protein_identity
mutations
```

Important semantics:

- `lifton_category` is LiftOn's `coding`, `non-coding`, or `other` category.
- `status` is `mapped`, `extra-copy`, or `unmapped`.
- `copy_number` is `0` for the primary copy and positive for additional copies.
- `target_id` is the raw LiftOn ID, not necessarily the ID in a rewritten final GFF3.
- identity columns are the lowest transcript-model values below that target copy.
- mutations are distinct classifications observed below that target copy.

The table is deterministic in reference-file order, then target copy number.

### `results/metrics.json`

Top-level fields:

```text
schema_version
generated_at
workflow
definitions
detail_column_definitions
transfer
prefix
validation
```

Current transfer metrics:

```text
reference_features
reference_features_by_type
mapped_features
mapped_features_by_type
unmapped_features
unmapped_features_by_type
mapping_fraction
target_feature_copies
target_feature_copies_by_type
features_with_extra_copies
features_with_extra_copies_by_type
extra_copies
miniprot_rescues
transfer_methods_by_target_copy
changed_primary_protein_coding_features
mutation_classifications_by_target_copy
dna_identity_by_transcript_model
protein_identity_by_transcript_model
authoritative_sources
detail_enrichment_source
```

Metric units are intentionally explicit:

- mapping counts use reference features;
- target-copy metrics use emitted target copies;
- changed primary models exclude mutations found only in extra copies;
- identity summaries use transcript models carrying the corresponding LiftOn attribute;
- mutation counts mean target copies carrying each classification, not mutation-event counts.

Short explanations are persisted in `definitions` and `detail_column_definitions` and shown on the result help page next to its longer explanations.

### `results/summary.json`

The summary is the future TUI entry point. Current top-level fields:

```text
schema_version
generated_at
workflow
run
status
status_explanation
metrics
generated_reports
source_evidence
```

Supported statuses:

```text
completed
completed-with-warnings
validation-failed
```

`metrics.payload` contains the complete workflow-specific metrics object, while `metrics.path` links to `results/metrics.json` for direct inspection.

`generated_reports` links to:

- per-feature transfer TSV;
- metrics JSON;
- completion summary;
- validation report;
- final GFF3 consumed by downstream stages.

`source_evidence` links to the raw GFF3 and LiftOn reports and records whether each path was available when the summary was written.

## Current validation behavior

The GFF3 validator preserves a structured failed report instead of failing its own rule. The summarizer therefore always has evidence available and writes:

```text
status: validation-failed
```

when validation errors exist.

Slice 2 makes the explicit contract that structural validation failure leaves Snakemake successful after it persists `validation.json`, `summary.json`, artifact records, and provenance. Process failure is reserved for execution failures or missing/contradictory evidence that prevents a trustworthy summary. Result consumers must therefore use the persisted summary status rather than equating process exit code zero with a scientifically valid annotation. This behavior is covered by a complete direct-Snakemake test. A separate final failing gate is not currently justified because it would conflate a preserved, interpretable scientific result with failure to produce results; reconsider it only if a concrete external automation consumer requires that exit-code policy.

## Deferred identifier rewriting

The current prefix-only rewrite is provisional. Do not extend it during result-page work.

The later redesign is documented in [`later.md`](../../../later.md) under **Post-LiftOn identifier rewriting**. It should support a reviewed regular-expression search-and-replacement step after preserving raw LiftOn output, with previews, collision checks, provenance, and distinct raw/final IDs.

Until then:

- result tables expose raw LiftOn IDs;
- explanations must say that they are raw IDs;
- do not pretend `target_id` is guaranteed to match the rewritten final GFF3.

## Workflow-bound result presentation

The result framework may have a generic shell, but scientific interpretation must be bound to a supported workflow contract.

For the first implementation, support only:

```text
workflow ID: annotation-transfer
workflow version: 1
summary schema: 1
metrics schema: 1
```

The following must agree before metrics are rendered:

```text
saved config workflow ID/version
packaged manifest workflow ID/version
summary workflow ID/version
annotation-transfer result reader support
```

A changed workflow label or description must not break loading. Identity uses stable workflow ID and workflow version.

Do not interpret an unknown workflow's `summary.json` as annotation-transfer results.

## Implemented slices

### Slice 1: artifact and provenance records (implemented)

Direct Snakemake execution now writes `artifacts.yaml` and `provenance/run.json` through the final `record_annotation_transfer_provenance` rule. The records include checksums, producer and configuration identity, commands, configured and observed tool versions, resources, timestamps, effective configuration, input provenance, logs, and the LiftOn benchmark.

Implement persisted artifact and provenance records for:

- resolved inputs;
- raw and optionally rewritten GFF3;
- LiftOn diagnostics;
- validation report;
- per-feature TSV;
- metrics JSON;
- completion summary;
- complete logs and benchmark files where applicable.

Record:

- workflow ID and version;
- manifest schema version and full manifest checksum;
- commands and tool versions;
- timestamps;
- requested and effective resources;
- effective configuration;
- input and output checksums;
- generated/imported/cached origin.

Keep this producer-side and directly runnable through Snakemake. Do not add TUI-only provenance calculation.

Acceptance:

- direct Snakemake run writes complete records;
- checksums match generated files;
- raw LiftOn evidence remains identified separately from generated aggregation reports;
- prefix-only reruns reuse raw evidence but update affected downstream records.

### Slice 2: direct execution, failure, and resume contract (implemented)

The complete DAG is covered directly through Snakemake with deterministic synthetic LiftOn evidence, while the environment-gated real-LiftOn suite continues to verify the pinned tools. Coverage includes a successful fresh run, LiftOn process failure, missing and contradictory structured evidence, persisted `validation-failed` results, interruption and `--rerun-incomplete` resume in the same workspace, an up-to-date no-op rerun, and a prefix-only rerun that preserves both raw bytes and their recorded checksum.

The structural-validation exit contract is documented under **Current validation behavior**: Snakemake succeeds after preserving a `validation-failed` summary; execution and evidence-integrity failures still fail the process.

Original acceptance scope:

Cover:

- successful fresh run;
- failed LiftOn rule;
- failed summarization due to contradictory or missing LiftOn evidence;
- `validation-failed` summary behavior;
- interrupted run and Snakemake resume;
- no-op rerun when all outputs are current;
- prefix-only rerun behavior.

Decide explicitly whether structural validation failure should leave Snakemake successful with a failed scientific status, or whether a later gate should make the process fail after preserving the summary. Record that decision in tests.

### Slice 3: annotation-transfer result reader (implemented)

A strict workflow-specific reader is implemented at:

```text
src/workflows/annotation-transfer/results.ts
```

Responsibilities:

- parse JSON as `unknown`;
- require summary schema version 1;
- require workflow ID `annotation-transfer` and workflow version 1;
- require metrics schema version 1;
- reject malformed required fields and unknown scientific statuses;
- validate numeric counts and fractions;
- validate the workflow-specific metrics payload;
- resolve artifact paths relative to the run directory;
- reject absolute paths and traversal outside the run directory;
- report missing files independently rather than rejecting every other result.

Return a small presentation model rather than exposing arbitrary JSON throughout the UI.

Do not introduce a generic plugin API. A small explicit workflow-ID/version dispatch is sufficient for the first supported workflow.

The generic boundary is implemented at:

```text
src/workflows/results.ts
```

It resolves the saved and packaged workflow identity and invokes the annotation-transfer reader. Unsupported workflows, versions, and persisted schemas return structured compatibility errors.

Tests must cover:

- valid summary;
- changed workflow label with stable ID/version;
- workflow ID mismatch;
- unsupported workflow version;
- unsupported summary or metrics schema;
- malformed metrics;
- missing summary;
- path traversal;
- missing individual artifact or evidence path.

### Slice 4: reusable result screen (implemented)

A reusable shell and annotation-transfer-specific body are implemented at:

```text
src/ui/run-results-screen/screen.tsx
src/ui/run-results-screen/annotation-transfer-results.tsx
```

The generic shell presents:

- run ID, name, description, and workflow identity;
- persisted status and explanation;
- timestamps and resources when available;
- logs and provenance;
- compatibility or missing-artifact warnings.

The annotation-transfer body presents:

```text
Transfer
  selected reference features
  mapped and unmapped features
  mapping percentage
  emitted target copies
  features with extra copies
  additional copies
  miniprot rescues

Model evidence
  changed primary protein-coding features
  mutation classifications
  DNA identity summary
  protein identity summary

Validation
  status
  error count
  warning count

Generated reports
  per-feature TSV
  metrics JSON
  validation JSON
  final GFF3

Source evidence
  raw LiftOn GFF3
  LiftOn run manifest
  completeness table
  mapped features
  unmapped features
  extra-copy features
  complete LiftOn diagnostics
```

Always show visible filesystem paths. OSC 8 terminal hyperlinks or opening files directly remain optional later work.

Do not render all per-feature TSV rows in Ink. Showing the path is sufficient for this slice.

### Slice 5: post-execution handoff (implemented)

After a real execution exits, the execution flow loads the persisted result through the same reader used for existing runs and presents it with `RunResultsScreen`. Both successful and failed processes retain their exact stdout/stderr paths in the handoff; missing, corrupt, or unsupported persisted results remain structured compatibility states rather than being replaced with transient execution data.

Flow:

```text
execute Snakemake
    -> process exits
    -> load results/summary.json from disk
    -> validate workflow-bound contract
    -> show RunResultsScreen
```

Do not pass temporary in-memory metrics from the execution screen. Reload persisted output so fresh and reopened runs exercise exactly the same path.

Behavior:

- process success plus summary `completed`: show success;
- process success plus `completed-with-warnings`: show completed with review warning;
- process success plus `validation-failed`: show scientific validation failure and retained evidence;
- process success but missing/corrupt summary: show that execution ended but results cannot be interpreted;
- process failure with an existing summary: show failure plus available persisted evidence and logs.

### Slice 6: open existing run (implemented)

**Open existing run** now uses the default `runs` collection, discovers packaged workflows, lists each workflow's persisted run directories with readable metadata, and opens the selected run through the same result reader and screen used after execution. Discovery retains saved names, descriptions, workflow identity, and creation times when available. It distinguishes compatible scientific statuses, missing summaries, corrupt saved data, unsupported identities, and missing linked paths without invoking Snakemake.

Implemented files:

```text
src/workflows/run-discovery.ts
src/ui/open-run-screen/screen.tsx
```

Flow:

```text
welcome screen
    -> Open existing run
    -> select workflow and run from the default runs collection
    -> list runs with readable researcher-facing metadata
    -> load saved config and summary
    -> resolve supported workflow adapter
    -> show RunResultsScreen
```

Run list entries retain:

- unique run ID;
- optional name and description;
- saved workflow label;
- stable workflow ID and workflow version;
- creation time;
- discoverable status when a compatible summary exists.

Handle these states independently:

- completed and compatible;
- completed with warnings;
- validation failed;
- incomplete or process failed;
- missing summary;
- corrupt summary;
- unsupported workflow or version;
- stale or missing individual artifacts.

Opening a run must never rerun Snakemake automatically.

### Slice 7: result help page and precise labels (implemented)

Implemented in `src/workflows/annotation-transfer/result-help.ts` (explanations and LiftOn values), `src/ui/run-results-screen/help.tsx` and `run-help.ts` (help page and run-level entries), and `collect_transfer_metrics.py` (`UNCHANGED_PROTEIN_CLASSES` and unit-explicit definitions). `?` opens the help page and Esc or `?` returns with the result scroll position kept. Unchanged protein classes are `identical`, `synonymous`, and `non_coding`. LiftOn's `miniprot_rescued_genes` counts only its separate rescue pass, so it can be lower than the target copies with transfer method `miniprot`.

Original scope:

The result screen currently shows metrics without any explanation. The persisted one-line `definitions` and `detail_column_definitions` are validated by the reader and then discarded. Several labels also leave the counting unit ambiguous. This slice adds a dedicated help page for the result screen and tightens the labels, the persisted definitions, and one metric at the same time.

#### Help page

- Open it from the result screen with a documented key, such as `?`. Esc returns to the result screen at the same scroll position. Do not bind exit.
- Make it scrollable and resize-aware, using the same controls as the result screen.
- Group the entries in the same order as the result sections: Transfer, Model evidence, Validation, Generated reports, Source evidence, and Run files.
- For each metric entry, show the displayed label, the persisted one-line definition from the run's `metrics.json`, and a longer explanation. Always state the counting unit: reference features, target copies, genes, or transcript models.
- Keep the main result page compact. Explanations appear only on the help page.

Source of the text:

- **Short definitions** remain producer-side in `collect_transfer_metrics.py`. They travel with the persisted data, and the help page reads them from the loaded result. Expose them in the reader's presentation model instead of discarding them.
- **Longer explanations** live in TypeScript next to the reader (`src/workflows/annotation-transfer/`), keyed by stable metric keys and bound to workflow ID `annotation-transfer` and version 1. Do not add a YAML help schema or plugin API.
- **LiftOn value explanations** are keyed by the exact strings written by LiftOn 1.0.13 and verified against its source. Show unknown values verbatim with a note that this application has no explanation for them.

Topics the help page must cover:

- Reference feature versus target copy. Primary copy (`copy_number` 0) versus additional copies.
- Mapped share: its unit is selected top-level reference features, not transcripts or target copies.
- Reference features with additional copies versus the number of additional target copies.
- Transfer methods. The gene-level `source` attribute is `Liftoff` or `miniprot`. The transcript-level `status` attribute is one of `Liftoff`, `LiftOn_chaining_algorithm`, `LiftOn_miniprot`, `miniprot`, or `no_ref_protein`. Also explain what a miniprot rescue is and that it counts genes.
- DNA identity versus protein identity, why each is summarized per transcript model, and what min/mean/max mean there.
- Every mutation class LiftOn 1.0.13 can write, from `lifton/variants.py`:
  - `identical`
  - `synonymous`
  - `nonsynonymous`
  - `frameshift`
  - `start_lost`
  - `inframe_insertion`
  - `inframe_deletion`
  - `stop_missing`
  - `stop_codon_gain`
  - `non_coding`
  - `full_transcript_loss`
  - `no_protein`

  Also state that the counts are target copies carrying a class, not mutation events, and that one copy can carry several classes.
- Scientific status versus process exit: `completed`, `completed-with-warnings`, and `validation-failed`. Validation errors versus warnings, and that they concern the structural check of the final GFF3.
- Raw LiftOn ID versus the later rewritten final ID. The per-feature TSV contains raw IDs.
- Generated reports versus source evidence. The `(missing)` and "unavailable when summarized" markers.

#### Label precision

Review every label on the result screen against the collector's actual counting. Planned changes, with final wording decided during implementation:

| Current | Problem | Direction |
|---|---|---|
| Selected reference features | unit implicit | Reference features selected for transfer |
| Mapped / Unmapped features | "features" is ambiguous (reference or target) | Mapped / Unmapped reference features |
| Mapping percentage | denominator implicit | Mapped share of selected reference features |
| Emitted target copies | unclear whether this includes additional copies | Target copies (primary + additional) |
| Features with extra copies | mixes the terms "extra" and "additional" | Reference features with additional copies |
| Additional copies | unit implicit | Additional target copies |
| Miniprot rescues | unit (genes) implicit | Genes rescued by miniprot |
| Transfer methods by target copy | reads as a property of the copy | Target copies by transfer method |
| Changed primary protein-coding features | does not say which change counts (see metric fix below) | Coding reference features with a protein-level change in the primary copy |
| Mutation classifications | unit implicit | Target copies by mutation class |
| DNA identity / Protein identity | unit implicit | Transcript-model DNA / protein identity |
| Validation: Status / Errors / Warnings | does not say what was validated | Final GFF3 structural validation |
| Metrics payload and Metrics JSON | both point to `results/metrics.json` | show it once |

Also tighten the persisted `METRIC_EXPLANATIONS`. For example, `dna_identity_by_transcript_model` currently expands the acronym DNA instead of defining the metric. Give every definition an explicit unit. The key set stays the same, and pre-release no version bump is needed.

#### Metric fix: changed primary protein-coding features

`collect_transfer_metrics.py` counts a primary coding copy as changed when it carries any class other than `synonymous`. LiftOn 1.0.11 writes `identical` for unchanged models, so unchanged genes are counted as changed, and so are `no_protein` and `full_transcript_loss`. This contradicts the persisted definition ("non-synonymous"). The fixtures contain no `identical` values, so no test caught it.

- Decide and document the included set. Proposed: every class except `identical` and `synonymous`. Losses count as changes, and `non_coding` cannot occur on coding features.
- Add a Python test with `identical` and loss classes on primary coding copies.
- Align the persisted definition, the label, and the help text with the chosen set.

#### Tests

- Give result-section items stable IDs (the metric keys), and assert that every ID rendered on the result page has a help entry. Do not assert label text.
- Opening and closing the help page through injected input keeps the result scroll position. Scrolling and resizing work on the help page.
- The persisted definition shown comes from the loaded result. Use a fixture with its own definition text.
- A missing persisted definition or an unknown LiftOn value renders without crashing and is marked as unexplained.
- Python: changed-feature counting for the new class set, and all definitions are present.

## Result-page compatibility behavior

### Compatible

Render workflow-specific metrics and all available links.

### Unsupported workflow or workflow version

Show run metadata, logs, and raw artifact paths, but do not interpret the scientific payload.

### Unsupported summary or metrics schema

State that the application version cannot interpret the persisted contract. Preserve access to original files.

### Missing summary

Do not automatically call the run failed. It may be an older run or an incomplete summarize stage.

### Missing individual artifact

Show availability per artifact. One missing evidence file must not hide all remaining results.

### Corrupt or contradictory result

Show a clear compatibility/data-integrity error and retain direct paths to logs and the run directory. Do not guess values.

## Tests and verification

Every slice must include tests and finish with:

```bash
cd tui
pnpm test
pnpm typecheck
pnpm build
pnpm pack:local
```

After changing workflow files, also run from the repository root:

```bash
python3 -m unittest discover -s tests -p "test_*.py"
```

When the managed LiftOn environment is available, run the direct integration suite with the managed Snakemake and LiftOn binaries on `PATH`.

Use only synthetic fixtures in committed tests. Existing private runs may be used for local smoke testing but must not be committed or referenced by reusable workflow code.

## Non-goals for these slices

Do not add yet:

- interactive browsing of every feature-transfer row;
- inline explanations beside every metric on the main result page;
- final regex identifier rewriting;
- semantic exon or transcript structure comparison;
- protein extraction or BUSCO presentation;
- inversion or structural-variant inference;
- comparison between separate runs;
- browser reports;
- dynamic workflow-result plugins;
- a generic metrics language designed for hypothetical workflows.
