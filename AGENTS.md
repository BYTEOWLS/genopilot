# AGENTS.md

## Scope

GenoPilot is a guided terminal interface and npm package for running curated, reproducible genome workflows. It configures and starts packaged Snakemake workflows; every workflow remains runnable directly through Snakemake without the TUI.

Keep the package independent of private research data, machine-specific paths, and any single project's organisms, samples, or accessions.

## Repository map

- `src/` — TypeScript/Ink CLI.
- `workflows/` — packaged Snakemake assets, one directory per workflow with its entry Snakefile, manifest, parameter definitions, and `README.md` documenting its science and outputs. `reference-consensus/` also holds its own `rules/*.smk`, `scripts/*.py`, and `envs/<name>/environment.yaml`; `shared/` holds annotation-transfer's rules, scripts, and environments together with what both workflows use, including `logging/` (the Snakemake logger plugin that records structured run events).
- `tests/` — TypeScript application tests plus Python tests for the shared rules, their scripts, and direct-Snakemake execution.
- `tests/fixtures/` — small synthetic, redistributable FASTA/GFF3 fixtures with known expected results.
- [`resources/tasks.md`](resources/tasks.md) — open work as checkboxes, in execution order.
- [`later.md`](later.md) — deferred and optional ideas.
- `resources/concepts/` — design notes; `done/` holds implemented designs.

## Architecture boundaries

- Use TypeScript, Ink, and React.
- Use pnpm for development and dependency management. Keep dependency versions exact.
- Prefer Node built-ins over additional runtime dependencies.
- Always use braces for control-flow statements, including single-line `if` branches.
- Honor the Snakemake and interaction boundaries below. The TypeScript application must not implement a second scheduler.
- Discover workflows through packaged manifests. Never hard-code workflow names, sample names, isolate counts, exclusions, local paths, or private accessions.
- Resolve packaged resources relative to the installed application rather than the caller's working directory.

## Snakemake and interaction boundaries

- Use Snakemake as the only workflow scheduler.
- Keep every workflow runnable directly without the TUI.
- Validate configurations only in the application. Snakefiles trust the saved `config.yaml` and its snapshots and do not repeat that validation in Python; direct runs are supported only with unmodified packaged workflows and application-saved configurations. Validation a run needs — resolved inputs, input files, and intermediate outputs — stays in the workflow's rules.
- Keep Snakemake rules non-interactive.
- Stop at explicit decision targets, let the TUI save decisions to YAML, and then invoke the next target.
- Reuse completed upstream artifacts when only decisions or reports change.
- Preserve diagnostic outputs rather than overwriting evidence with final decisions.

Write rule scripts against the standard library only, so their tests run without a provisioned environment. Give a rule a `params:` function only when an argument is not already a fixed literal, and let that function take `wildcards` alone, repeating its rule's paths as literals: a params function that declares an `input` or `output` parameter is not recorded in Snakemake's per-job metadata, so a configuration-only change would silently fail to trigger a rerun.

Validate imported artifacts and record their checksums, versions, configuration compatibility, and generated/imported/cached origin. An input file from outside the workflow is `imported`, including a verified reuse of the NCBI download cache (recorded through `downloaded: false`); `cached` is reserved for a stage whose results are reused from elsewhere instead of computed in this run. Never manipulate timestamps to trick Snakemake. Clearly label cached or imported stages and never simulate expensive computation.

## Scientific and reproducibility guidelines

- Pin Snakemake, bioinformatics tools, databases, and environment definitions.
- Record effective configuration, decisions, commands, logs, versions, checksums, and reference accessions for every run.
- Never silently resolve ambiguities or annotation conflicts.
- Validate inputs and intermediate outputs (FASTA, GFF3, alignments, variant calls, proteins) before dependent stages run.
- Use the same versions, parameters, and databases when comparing genomes.

## Runtime and interaction

- Assume users install Node manually. Verify or bootstrap the approved Pixi runtime only with explicit consent and verified downloads. Install Snakemake and Conda together so Snakemake can provision rule-specific environments.
- Do not describe tooling as ready until its compatibility has been validated against configured requirements.
- Let Snakemake provision pinned per-rule environments; do not run bioinformatics tools directly as an alternative execution path.
- Show exact commands. Capture complete Snakemake stdout and stderr separately from the Ink dashboard.
- Propagate cancellation to Snakemake and wait for cleanup before exiting.
- Keep unavailable commands visibly marked as placeholders; never imply incomplete behavior works.
- Keep layouts responsive to terminal resizing and usable without color.
- Use the alternate-screen buffer for the interactive application to avoid polluting terminal history during rerenders.
- A user-requested interactive exit requires two `Ctrl+C` presses within two seconds. Do not bind `q`, Escape, or a menu command to exit.
- Build every screen on the shared `Page` component (title, optional description, content, shortcut line ending in Esc and `h — Home`) and forms on `EditPage`, whose save button is a selectable row. In forms, Tab and the arrow keys move between fields; Enter only activates the selected button (or opens the file browser on a path field) and never moves on or submits from a text field. Validation runs when the save button is pressed and its problems are shown by `EditPage`.

## Data contracts

- Use YAML for workflow configuration and saved decisions.
- Use TSV for tabular metadata and results where appropriate.
- Use JSONL only for structured progress events.
- Preserve generated, imported, and cached provenance distinctions in all run views.

## Implementation design

- Follow the KISS principle: choose the simplest design that satisfies the current, demonstrated requirement.
- Treat the architecture as provisional. Build small, clear implementations that are easy to revise.
- Generalize, abstract, or decouple only when a concrete second use or demonstrated problem requires it.
- Do not add speculative fields, abstractions, extension points, or execution behavior merely because they might become useful later.
- Keep the active task small. Move ideas that are not needed for the current task to [`later.md`](later.md).
- Prefer a deliberate later schema or interface revision over premature complexity, while preserving explicit versioning and migration boundaries where persisted data requires them.
- Treat performance as a non-functional requirement: runs should fit a time, disk, and memory budget a researcher can plan for, also on slower machines. Measure before optimizing, and avoid work that grows with the square of the cohort or genome where a linear approach is as simple. A deep performance review is deferred ([`later.md`](later.md#performance-review)).

## Package and documentation

- Treat `package.json` as the source for the displayed command name, description, author, and version.
- Keep user and developer documentation in [`README.md`](README.md) and package changes in [`CHANGELOG.md`](CHANGELOG.md).
- Do not document TUI usage (screens, keys, navigation) in the README; the in-app help page covers it.
- Document each workflow's inputs, parameters, steps, scientific decisions, and outputs in its `workflows/<id>/README.md`, using only the Markdown subset in [`resources/concepts/workflow-documentation.md`](resources/concepts/workflow-documentation.md), and update it in the same change as the workflow.
- When changing a pinned tool version in `src/tooling/policy.ts` or a `workflows/*/envs/` directory, update the version tables under *Tooling policy* in the README in the same change.
- Track open work as concise checkboxes in [`resources/tasks.md`](resources/tasks.md), linking to a concept instead of repeating its checklist, and remove items once done. Keep rationale in design documentation rather than the task list.
- Use pnpm to build and pack locally, and npm for global test installation.
- Ensure packed artifacts contain the compiled CLI, packaged workflows, and package documentation, but not source data, private files, tests, or development-only configuration.

## Git workflow

- Develop trunk-based on `main`, which must always pass CI.
- Use short-lived `feat/…` or `fix/…` branches for larger changes.
- Release by tagging `vX.Y.Z` on `main`; versions stay in the `0.x.x` range while contracts are unstable. Published npm versions are immutable.
- Keep commit messages concise. Do not add `Co-Authored-By` trailers or any AI/tool attribution.

## Privacy and repository hygiene

- Never commit or attach raw sequencing data, unpublished assemblies, restricted workbooks, credentials, API keys, or collaborator data — including in issues, fixtures, and pull requests.
- Keep downloaded databases, generated environments, run workspaces, and results out of Git.
- Commit only small synthetic fixtures with documented origin, schemas, workflow definitions, environment files, and documentation.

## Verification

Before considering a change complete, run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm pack:local
```

After changing anything under `workflows/`, also run:

```bash
python3 -m unittest discover -s tests -p "test_*.py"
```

Direct-Snakemake execution tests skip themselves unless the pinned `snakemake` is on `PATH`; per-rule Conda provisioning is opt-in through `RUN_SNAKEMAKE_CONDA_INTEGRATION=1`.

Tests should cover visible states, input behavior, cancellation/exit behavior, resizing, and failure paths. Treat UI labels as mutable presentation text: do not assert exact command, workflow, field, or screen labels, and do not use those labels as behavioral selectors. Test functionality through stable IDs, injected callbacks, state transitions, and observable outcomes instead. Inject external checks and process runners so unit tests do not depend on locally installed bioinformatics tooling.
