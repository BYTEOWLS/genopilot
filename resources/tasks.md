# Tasks

Open work only, in execution order. Finished work is recorded in the concepts under [`concepts/done/`](concepts/done/) and in Git history; deferred ideas are in [`later.md`](later.md). Work that has a concept is listed here by a link, and its concept holds the detailed checklist.

## Definition of done

Every task includes proportionate unit tests in the same change. A task is not complete until its tests, `pnpm typecheck`, `pnpm build`, and `pnpm pack:local` pass. Add integration tests when they protect a meaningful cross-process, filesystem, package, or Snakemake contract; do not duplicate covered behavior merely because a thin injected wrapper crosses a boundary.

## Workflows

- [ ] Save isolate FASTAs from a run to the isolate catalog ([concept](concepts/saved-isolate-sequences.md)).
- [ ] Annotation review: rate transferred proteins, list genes to review, record verdicts and candidate-model choices, and suggest transferring the consensus annotation ([concept](concepts/annotation-review.md)).
- [ ] GFF3 ID find-and-replace ([concept](concepts/annotation-id-rewriting.md)); required before INSDC submission.
- [ ] INSDC submission preparation (NCBI, ENA, or DDBJ): genome and isolate reads ([concept](concepts/insdc-submission/README.md)).

## Application

- [ ] Add non-interactive `--help` and `--version` output.
- [ ] Add start and finish times, total and per-stage duration, and available resource metrics to the run results; status, creation time, effective CPUs, and validation counts are shown.
- [ ] Show a systems check before a run: free disk against an estimate, CPUs, and memory, and duration estimates from the machine's completed runs ([concept](concepts/systems-check.md)).
- [ ] Resume an incomplete run from the open-run screen in its own workspace, and load runs by stable workflow ID and version even when the manifest's label or description changed. Direct Snakemake resume is covered; take this up with [workflow cancellation](later.md#workflow-cancellation).
- [ ] Add continue-from-stage, rerun-stage, and presentation-mode actions.
- [ ] Open a local browser view from the CLI, starting with the help documents, then genomes and their evidence ([concept](concepts/browser-view/README.md)).
- [ ] Separate workflow-specific UI and result code from the shared screens, so each workflow plugs in through one module ([notes](later.md#workflow-code-layout)).

## Integration and packaging

- [ ] Add a direct-Snakemake cancellation test that checks cleanup and complete logs; success, failure, and resume are covered, and cancellation is covered only with an injected process.
- [ ] Publish one bundled `dist/cli.js` without runtime dependencies, so every transitive dependency is pinned by the lockfile ([concept](concepts/bundled-package.md)).
- [ ] Verify the packed CLI and bundled manifests in a clean temporary installation.

## Tooling

- [ ] Save complete tooling-check logs outside the Ink render output; setup logs are already preserved.
- [ ] Before 0.1.0: pin LiftOn's pip dependencies with `==` in its rule environment; they are declared only as lower bounds upstream and installed from PyPI when the environment is created.
- [ ] Before 0.1.0: record each rule environment's explicit conda package list and `pip freeze` in run provenance.
- [ ] Before 0.1.0: lock the rule environments' conda dependencies with Snakemake's per-platform pin files (`<environment>.<platform>.pin.txt`).
- [ ] Run real installation smoke tests on each supported platform/architecture and record the tested versions.

## Windows support (last)

- [ ] Add and validate Windows support through WSL2; native Windows execution is out of scope.
