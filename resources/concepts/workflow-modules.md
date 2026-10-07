# Workflow modules

## Goal

Everything a workflow does in the application lives with that workflow, and the shared screens know a workflow only by its ID. Adding or changing a workflow then touches its own folder and one registry line, and reading a workflow's behavior means reading one folder instead of following it through shared screens.

The Snakemake side already works this way for reference-consensus: its rules, scripts, and environments sit next to its Snakefile, and `workflows/shared/` holds only what both workflows use. This concept applies the same feature-oriented layout to `src/`, for both workflows.

## Where workflow code sits today

Both workflows keep their domain code in `src/workflows/<id>/`, but their screens and parts of their result loading sit in shared places, and the shared code names them:

| Shared file | Workflow-specific content |
|---|---|
| `src/ui/new-run-screen/screen.tsx` | the `configurationScreens` map, one entry per workflow |
| `src/ui/new-run-screen/` | `annotation-transfer-configuration.tsx`, `reference-consensus-configuration.tsx` |
| `src/workflows/results.ts` | imports both workflows' configuration and result types for its union; annotation-transfer's summary reading and identity checks inline, reference-consensus's snapshot loading as a local function; both shell mappings |
| `src/workflows/annotation-transfer/results.ts` | defines `ResultPath`, which the shell and reference-consensus also use |
| `src/ui/run-results-screen/` | `annotation-transfer-results.tsx`, `protein-review.tsx`, `transfer-genome-views.tsx`, `reference-consensus-results.tsx`, `cohort-review.tsx` |
| `src/ui/run-results-screen/screen.tsx` | the reference-consensus tab, isolate, cohort, and sites state, its keys, scroll following, genome views, decision review, and iteration rerun; annotation-transfer's tab state and its two hooks; per-workflow shortcuts, back targets, and row counts |
| `src/ui/new-run-screen/workflow-execution.tsx`, `workflow-configuration.tsx`, `src/ui/open-run-screen/screen.tsx` | pass reference-consensus's `CohortRerun` through to the results |

Annotation-transfer's results already reach the shell mostly through two hooks (`useProteinReview`, `useTransferGenomeViews`) that return their input handling, shortcuts, and back target; reference-consensus's results are written into the shell itself.

## Target layout

```
src/workflows/
├── registry.ts                 The only shared file that names workflows: ID → module
├── results.ts                  Generic: reads config.yaml, checks the identity, ResultShell, ResultPath;
│                               dispatches to the module's loadResult
├── annotation-transfer/
│   ├── index.ts                The workflow's module, the shared screens' only entry point
│   ├── configuration.ts, run-configuration.ts, results.ts, proteins.ts, views.ts
│   ├── load-result.ts          Its part of loading a run: summary, identity checks, shell status
│   └── ui/
│       ├── configuration-screen.tsx
│       ├── results.tsx         Its result view hook: tabs, body, keys, shortcuts
│       ├── protein-review.tsx
│       └── genome-views.tsx
└── reference-consensus/
    ├── index.ts
    ├── configuration.ts, run-configuration.ts, results.ts, cohort-decision.ts, iteration-run.ts,
    │   isolate-results.ts, sites.ts, snapshot.ts, views.ts
    ├── load-result.ts          Its part of loading a run: isolate snapshot, shell status
    └── ui/
        ├── configuration-screen.tsx
        ├── results.tsx         Tabs, isolate/cohort/sites state, keys, scroll following, genome views
        └── cohort-review.tsx   Decision review and iteration rerun
```

Generic components the workflow screens use, such as `Page`, `EditPage`, `Tabs`, `Table`, the isolate field, and `WorkflowConfigurationScreen`, stay under `src/ui/`.

## The module

One `WorkflowModule` type, and each workflow exports one value of it:

- `id` and `version`: the configuration contract it reads, as today's `*_WORKFLOW_ID` and `*_WORKFLOW_VERSION`.
- `ConfigurationScreen`: receives the discovered workflow and the shared props the new-run screen passes today.
- `loadResult(directory, configurationPath, source)`: everything after the shared identity check; returns the workflow's result and its `ResultShell`, or an incompatibility.
- `useResultView(...)`: given the loaded result, the run directory, the manifest, the genome browser session, and whether input is active, returns the tabs, the body, `handleInput`, shortcuts, the back target, and the rows it adds. Annotation-transfer's two hooks already have this shape.

The results shell keeps what every workflow shares: scrolling, help, the citation tab, the run title, and the genome browser session. It hands everything else to the module and never branches on a workflow ID.

Reference-consensus's iteration rerun stays its own: `CohortRerun` moves into its folder, and the shared execution and open-run screens pass the module what it needs (such as the Snakefile path) instead of a reference-consensus type. Whether that is a generic `snakefilePath` on the result view's inputs or something narrower is decided while moving it.

## Open questions

- Configuration mapping (moved here from `later.md`): each workflow's `configuration.ts` and `run-configuration.ts` map generic manifest parameters to and from `config.yaml`. Check which parts a manifest-driven mapping could replace, and keep only the workflow-specific ones, such as the isolate snapshot and the review details. Decide at the kickoff whether this is part of this concept or stays in `later.md`.
- Whether `useResultView` returns one object or the shell asks the module for tabs and body separately; settle it on annotation-transfer, which already has hooks, before reference-consensus.

## Work

- [ ] `ResultPath`, the configuration reading, and the identity check generic in `src/workflows/results.ts`; each workflow's loading moves to its `load-result.ts`.
- [ ] `WorkflowModule`, the registry, and annotation-transfer's module; its configuration screen, results, protein review, and genome views move into its `ui/`; the new-run and results screens dispatch through the registry.
- [ ] Reference-consensus's module: its configuration screen, results, and cohort review move into its `ui/`, its tab, sites, and rerun state leaves the results shell, and `CohortRerun` leaves the shared screens.
- [ ] Tests move with the code into `tests/workflows/<id>/`; shared-screen tests use a stub module and assert dispatch, not a workflow's content.
- [ ] Update the repository map in `AGENTS.md`.

## Acceptance

No file outside `src/workflows/<id>/` and `src/workflows/registry.ts` imports from a workflow's folder or branches on a workflow ID, and adding a third workflow's screens needs no change to a shared screen.
