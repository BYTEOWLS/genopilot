# Task 5.3 — Review and rerun

## Goal

Make ties and supporting evidence reviewable, save a reasoned decision from the TUI, and run the resulting iteration through its Snakemake target.

Depends on the decision contract and targets of [Task 5.1](5a-cohort-iterations.md) and the results view of [Task 5.2](5b-results-view.md).

## Kickoff decisions

- **Two surfaces.** The results view switches tabs with Tab, and a form moves between its fields with Tab, so one screen cannot hold both. The evidence is a read-only **Sites** tab of the results view; the decision is a separate form opened from the results.
- **Sites tab.** It shows the cohort selected on the Iterations tab, the active one by default, and names it. Only a cohort with support tables has sites. A filter cycles through ties, no majority, competing indels, and every unresolved locus. Each row shows the locus, the backbone allele, the alleles with their votes, the reason, and the flags; its detail shows the backbone vote and every voter's allele or callability state with the voter's snapshot metadata. The rows come from streaming `consensus-sites.tsv.gz` beside `support-sites.tsv.gz`, whose locus rows correspond one to one, on demand and cancellably; only a window around the selection is rendered.
- **Decision form.** One row per selected isolate, toggled between voting and excluded, with its name, ID, wild-type status, `derived_from`, processing state, depth, covered and callable fraction, and PASS SNPs and indels; then the four cohort settings, the reason, and the save button. It is prefilled from the active cohort, or from every completed isolate and the configuration when no cohort was aggregated. An incomplete isolate can only be excluded. Metadata never preselects anything. The form validates only when saved, through Task 5.1's `saveCohortDecision`, and shows its problems, such as a decision that changes nothing.
- **Preview deferred.** Previewing how many unresolved sites a decision creates or resolves would need the voting rule a second time in TypeScript, and cannot be exact when a removed voter's variant split a locus or when the backbone vote is turned on from a table built without it. It moves to [`later.md`](../../later.md#cohort-decision-preview); the iteration comparison of Task 5.2 shows the change after the rerun.
- **Rerun gate.** After saving, the iteration target is dry-run with the run-events logger writing to a file of its own. Execution is offered only when the dry run's `run-info` event counts no other rule than `aggregate_support`, `generate_consensus`, and `record_iteration_provenance`; otherwise the screen names the other rules and explains that the change needs a new run. Console text is never parsed. A dry run that schedules nothing means the iteration is complete when its provenance exists, and is refused otherwise.
- **A refused decision stays pending.** It was saved before the dry run, which needs it; the decision and the dry run's logs remain as evidence, and decisions are never removed.
- **Resume.** A pending iteration on the Iterations tab can be continued, which opens the same dry run, gate, and execution. Iteration runs pass `--rerun-incomplete`, so a job killed while writing its output does not block the target; an incomplete per-isolate output still shows in the dry run and is refused.
- **Logs.** An iteration's Snakemake stdout and stderr are kept under `logs/cohort/iteration-<n>/`, next to the dry run's events. The execution appends to the run's `events.jsonl`, from which the iteration's provenance takes its commands; its progress is read from where the file ended when it started.
- **Back to the results.** After the rerun, the results view reloads and selects the new iteration.

## Review action

From a result, the researcher can open a review screen that:

- lists currently voting isolates with name, stable ID, wild-type status, `derived_from`, QC, coverage, and callable fraction;
- filters or navigates tied/no-majority SNPs and competing indels while showing backbone and per-isolate support;
- allows whole isolates to be included or excluded from voting, including an isolate whose processing failed;
- allows the cohort settings to be changed: the voting method, the backbone vote, the minimum of callable isolates, and the unresolved-SNP representation;
- previews how many unresolved sites the proposed decision would create or resolve when this can be calculated from the support table (deferred, see the kickoff decisions);
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

- [x] Record the kickoff decisions.
- [x] Implement tie/disagreement navigation and whole-isolate voting selection.
- [x] Implement cohort-setting changes; the before/after preview is deferred to [`later.md`](../../later.md#cohort-decision-preview).
- [x] Save the reasoned decision before preparing the rerun.
- [x] Invoke the iteration target without implementing a scheduler in TypeScript, refusing when per-isolate jobs would run.
- [x] Add tests for exclusion, excluding a failed isolate, setting changes, no-op decisions, a refused per-isolate recompute, cancellation, resume, and complete logs.

## Acceptance

A researcher can identify why positions are unresolved, exclude a poorly suited isolate or change the cohort settings with a recorded reason, and produce a new traceable consensus without rerunning any isolate's QC, alignment, callability, or variant calling.
