# Task 5.1 — Cohort iterations

## Goal

Let a saved, reasoned decision change which isolates vote and how the cohort consensus is chosen, and rerun only cohort aggregation and its dependent outputs in the same run directory. Each earlier result stays in place. A run with an unusable isolate becomes completable without processing the other isolates again.

This is the workflow-side contract that Tasks [5.2](5b-results-view.md) (results view), [5.3](5c-review-and-rerun.md) (review and rerun), and [5.4](5d-saved-isolate-sequences.md) (saved isolate sequences) build on. It covers the release basics of the [reruns concept](../reruns.md), which also explains why every other configuration change creates a new run.

## Kickoff decisions

- **Split.** Task 5 is split into four slices ordered by their persisted contracts: this task defines the decision, the iteration layout, and the Snakemake targets; 5.2 reads them; 5.3 writes decisions from the TUI and invokes the targets; 5.4 is independent of iterations and extends the isolate catalog.
- **What a decision may change.** The voting isolates and every cohort setting: `include_backbone_vote`, `voting_method`, `min_callable_isolates`, and `unresolved_snp`. None of them is read by a per-isolate step. A change to anything a per-isolate step reads creates a new run.
- **Iterations.** The initial run is iteration 1 and keeps `results/cohort/initial/`. Decision *n* (from 2 on) is saved as `decisions/iteration-<n>.yaml` and writes `results/cohort/iteration-<n>/` and `logs/cohort/iteration-<n>/`, with the same file names as `initial`. Every decision is complete in itself, so an iteration never depends on another one. Decision files are never overwritten, and numbers are never reused.
- **Validation** lives in the application only; the Snakefile trusts a saved decision like it trusts `config.yaml`. The voting and excluded isolates partition the run's `selected_isolates`, at least one isolate votes, `min_callable_isolates` does not exceed the number of voting isolates, every voting isolate completed its processing, a reason is given, the decision differs from every earlier iteration's settings, and its number is the next free one.
- **Targets, not a manifest contract.** The cohort rules take a `{cohort}` wildcard, `initial` or `iteration-<n>`. For an iteration, the decision file is an input of both cohort rules and replaces `selected_isolates` and the configuration's `consensus` block. Asking for `provenance/cohort/iteration-<n>.json` runs the iteration. `rule all` still describes the initial run and is unchanged. The manifest schema needs no decision fields.
- **No hidden per-isolate recompute.** Snakemake's rerun triggers can mark a voter's artifacts as outdated, for example after a package upgrade changed a rule. The iteration target is therefore dry-run first, and Task 5.3 runs it only when that dry run schedules nothing but `aggregate_support`, `generate_consensus`, and `record_iteration_provenance`; otherwise the change needs a new run. Timestamps and rerun triggers are never manipulated to avoid this.
- **Excluded isolates.** An iteration depends only on its voting isolates, so an excluded isolate is outside its DAG, also a failed one. Its logs and partial outputs stay in place as evidence. The iteration's provenance records every excluded isolate as `completed` or `incomplete`: a missing promotion candidate cannot tell a failed isolate from an interrupted one, and the decision's reason explains which it was.
- **Provenance.** `provenance/cohort/iteration-<n>.json` records the decision and its checksum, the effective voters and settings, the excluded isolates with their state, whether the initial cohort was aggregated, the checksums of every input and output, and the commands of the iteration's jobs. The run-level `artifacts.yaml` and `provenance/run.json` remain the record of the initial run.

## Saved decision

```yaml
schema_version: 1
iteration: 2
voting_isolates:
  - isolate-a
  - isolate-c
excluded_from_voting:
  - isolate-b
consensus:
  include_backbone_vote: true
  voting_method: plurality
  min_callable_isolates: 0
  unresolved_snp: n
reason: Excluded isolate-b after failed coverage review.
created_at: 2026-01-01T13:00:00.000Z
```

The decision is saved before Snakemake is invoked, and the rerun reuses every per-isolate artifact. Exclusion is global for the iteration, not a hidden site-by-site choice. Lineage and wild-type metadata inform the researcher but never make the decision automatically.

## Excluding a failed isolate

A failed isolate stops the cohort stages, so a run with one never completes (see [Task 4.2](4b-cohort-support-aggregation.md#kickoff-decisions)). When the failure can be fixed, rerunning the same run directory redoes only that isolate. When it cannot, for example because its reads are unusable, the researcher excludes it with a reason in the same run directory instead of creating a new run, which would align and call every other isolate again.

- The decision lists the isolate under `excluded_from_voting` with the reason, as for any exclusion.
- There is no all-selected initial support output in such a run, so this decision creates the first cohort iteration, and its provenance records that the initial cohort was never aggregated.
- The failed isolate's logs and partial artifacts stay in place; the iteration's provenance records it as excluded and incomplete, not as missing.
- The rerun targets only the iteration's cohort outputs and provenance, because a run's default target still asks for every selected isolate.

## Work

- [x] Record the kickoff decisions and split Task 5.
- [x] Define the versioned decision and iteration directory contracts.
- [x] Parametrize the cohort rules by iteration and read a saved decision's voters and settings.
- [x] Record iteration provenance that accepts excluded, incomplete isolates.
- [x] Validate and atomically save a decision in the application, never replacing an existing one.
- [x] Test decision validation, the iteration's DAG, excluded failed isolates, preserved initial outputs, and iteration provenance.

## Acceptance

A saved decision produces a new traceable consensus in its own iteration directory, directly through Snakemake, without rerunning any isolate's QC, alignment, callability, or variant calling, and without changing the initial result or an earlier iteration. A run with an unusable isolate can be completed by excluding it.
