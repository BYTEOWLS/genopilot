# Reruns — tasks

[Concept](concept.md). Steps affect this repository; general rerun work is unscheduled, not part of the current release.

- [x] Preserve cohort-only changes as iterations, including exclusion of failed isolates ([iteration contract](../completed/consensus/5a-cohort-iterations.md)).
- [x] Review saved decisions and launch their cohort target from the application ([review and rerun](../completed/consensus/5c-review-and-rerun.md)).
- [ ] Resume incomplete runs from the open-run screen in their own workspace, together with [deliberate cancellation](../../later.md#workflow-cancellation). Load runs by stable workflow ID and version even when manifest labels or descriptions change. Preserve logs and await cleanup before exit; direct Snakemake resume is already covered.

Additional rerun actions, source links, cross-run reuse, forced recomputation, and comparisons remain [deferred](../../later.md#reruns-of-existing-runs) until required.
