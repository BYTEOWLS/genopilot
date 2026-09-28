# Reruns of existing runs

## Goal

Let a researcher rerun an existing run with a changed configuration while every earlier result stays intact, so results can be compared.

A run directory cannot simply be rerun with an edited `config.yaml`: Snakemake replaces outputs in place, so changing, for example, `min_depth` would overwrite every isolate's variants and callable mask. Where a rerun writes therefore depends on what it changes.

## Model

- **Cohort-only changes** stay in the same run as a new iteration: the voting isolates, including excluding a failed isolate, the voting method, and the backbone vote. Nothing per-isolate reruns, and every earlier iteration is kept in its own directory. [Task 5](consensus/5-results-and-post-processing.md) defines the saved decision and the iteration layout.
- **Every other change** creates a new run in its own directory: calling thresholds, the backbone, the selected isolates' reads, or anything else a per-isolate step reads. The source run is never modified, and the new run computes everything again.

A run's saved `config.yaml` and `isolates.yaml` are never edited after it was created, by GenoPilot or by a researcher; the workflow README already says so for direct runs.

## Release basics

These are required before a release, because without them a run with one unusable isolate cannot be completed without recomputing the whole cohort, or a failed run cannot be finished from GenoPilot. They are tracked where they are designed:

- cohort iterations in the same run, and excluding failed isolates as the first iteration: [Task 5](consensus/5-results-and-post-processing.md);
- resuming an incomplete run in its own directory after its cause was fixed: [`tasks.md`](../tasks.md).

A changed per-isolate configuration already works as a new run: the configuration form is prefilled from a previous run, and the source run stays unchanged.

## Later

Nothing below is needed for the first release; each item waits for a concrete use case.

- **Rerun action on existing runs:** open the configuration of a selected run, prefilled, and after saving decide by the changed fields whether it becomes an iteration or a new run, showing the researcher which and why.
- **Link to the source:** a new run created this way records the run it was derived from in its configuration and provenance, so the two can be found and compared together.
- **Reuse across runs:** a new run could reuse the source run's unchanged upstream artifacts, for example the alignments when only calling thresholds changed, instead of computing them again. This needs compatibility rules per stage (the backbone, reads, and parameters each artifact depends on), checksum verification, and the `cached` origin in provenance, never timestamp manipulation.
- **Forced recompute of selected isolates:** redo chosen isolates although their results are current, for example after replacing a read file with a corrected copy of the same name. There is no use case yet.
- **Comparison view:** show two runs or iterations side by side, such as changed consensus bases, unresolved sites, and per-isolate callability.

## Acceptance

Before a release: no rerun changes an earlier result, a cohort-only change reruns only the cohort stages as a new iteration, and a run with an unusable isolate can be completed without processing the other isolates again.
