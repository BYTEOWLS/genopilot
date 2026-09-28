# Task 5.3 — Review and rerun

## Goal

Make ties and supporting evidence reviewable, save a reasoned decision from the TUI, and run the resulting iteration through its Snakemake target.

Depends on the decision contract and targets of [Task 5.1](5a-cohort-iterations.md) and the results view of [Task 5.2](5b-results-view.md).

## Review action

From a result, the researcher can open a review screen that:

- lists currently voting isolates with name, stable ID, wild-type status, `derived_from`, QC, coverage, and callable fraction;
- filters or navigates tied/no-majority SNPs and competing indels while showing backbone and per-isolate support;
- allows whole isolates to be included or excluded from voting, including an isolate whose processing failed;
- allows the cohort settings to be changed: the voting method, the backbone vote, the minimum of callable isolates, and the unresolved-SNP representation;
- previews how many unresolved sites the proposed decision would create or resolve when this can be calculated from the support table;
- requires a reason before saving.

At least one isolate remains selected for voting. Lineage and wild-type metadata inform the researcher but never make the decision automatically.

## Rerun

The TUI saves the decision with Task 5.1's validated primitive, dry-runs `provenance/cohort/iteration-<n>.json`, shows the exact command, and executes it only when the dry run schedules nothing but the three cohort rules. Otherwise it explains that the change needs a new run. An interrupted iteration is resumed by invoking the same target again.

## Post-processing actions in scope

- Inspect per-isolate and cohort artifacts.
- Open tie/disagreement review.
- Save a new voting subset and cohort settings.
- Dry-run and execute only affected Snakemake targets.
- Resume an interrupted post-processing rerun.

Annotation transfer, legacy-reference comparison, repeat analysis, antiSMASH, and manual site editing are later concepts rather than actions hidden inside this task.

## Work

- [ ] Implement tie/disagreement navigation and whole-isolate voting selection.
- [ ] Implement cohort-setting changes and an evidence-based before/after preview.
- [ ] Save the reasoned decision before preparing the rerun.
- [ ] Invoke the iteration target without implementing a scheduler in TypeScript, refusing when per-isolate jobs would run.
- [ ] Add tests for exclusion, excluding a failed isolate, setting changes, no-op decisions, a refused per-isolate recompute, cancellation, resume, and complete logs.

## Acceptance

A researcher can identify why positions are unresolved, exclude a poorly suited isolate or change the cohort settings with a recorded reason, and produce a new traceable consensus without rerunning any isolate's QC, alignment, callability, or variant calling.
