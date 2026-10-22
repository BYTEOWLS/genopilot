# Workflow modules — tasks

[Concept](concept.md). Steps affect this repository.

## Work

- [ ] `ResultPath`, the configuration reading, and the identity check generic in `src/workflows/results.ts`; each workflow's loading moves to its `load-result.ts`.
- [ ] `WorkflowModule`, the registry, and annotation-transfer's module; its configuration screen, results, protein review, and genome views move into its `ui/`; the new-run and results screens dispatch through the registry.
- [ ] Reference-consensus's module: its configuration screen, results, and cohort review move into its `ui/`, its tab, sites, and rerun state leaves the results shell, and `CohortRerun` leaves the shared screens.
- [ ] Tests move with the code into `tests/workflows/<id>/`; shared-screen tests use a stub module and assert dispatch, not a workflow's content.
- [ ] Update the repository map in `AGENTS.md`.
