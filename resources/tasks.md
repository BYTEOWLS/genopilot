# Tasks

Open work only, in execution order. Finished work is recorded in the concepts under [`concepts/done/`](concepts/done/) and in Git history; deferred ideas are in [`later.md`](../later.md). Work that has a concept is listed here by a link, and its concept holds the detailed checklist.

## Definition of done

Every task includes proportionate unit tests in the same change. A task is not complete until its tests, `pnpm typecheck`, `pnpm build`, and `pnpm pack:local` pass. Add integration tests when they protect a meaningful cross-process, filesystem, package, or Snakemake contract; do not duplicate covered behavior merely because a thin injected wrapper crosses a boundary.

## Workflows

- [ ] Reference-guided cohort consensus, from Task 5.2 on ([concept](concepts/consensus/README.md)).
- [ ] Post-LiftOn identifier rewriting ([concept](concepts/annotation-id-rewriting.md)); required before INSDC submission.
- [ ] INSDC submission preparation (NCBI, ENA, or DDBJ): genome and isolate reads ([concept](concepts/insdc-submission/README.md)).

## Application

- [ ] Write the annotation-transfer README and show each workflow's documentation in the application ([concept](concepts/workflow-documentation.md)).
- [ ] Replace the `Help` placeholder on the welcome screen with the in-app help page, and add non-interactive `--help` and `--version` output.
- [ ] Add start and finish times, total and per-stage duration, and available resource metrics to the run results; status, creation time, effective CPUs, and validation counts are shown.
- [ ] Show a systems check before a run: free disk against an estimate, CPUs, and memory, and duration estimates from the machine's completed runs ([concept](concepts/systems-check.md)).
- [ ] Resume an incomplete run from the open-run screen in its own workspace, and load runs by stable workflow ID and version even when the manifest's label or description changed. Direct Snakemake resume is covered; take this up with [workflow cancellation](../later.md#workflow-cancellation).
- [ ] Add continue-from-stage, rerun-stage, and presentation-mode actions.

## Integration and packaging

- [ ] Add a direct-Snakemake cancellation test that checks cleanup and complete logs; success, failure, and resume are covered, and cancellation is covered only with an injected process.
- [ ] Verify the packed CLI and bundled manifests in a clean temporary installation.

## Tooling

- [ ] Save complete tooling-check logs outside the Ink render output; setup logs are already preserved.
- [ ] Replace solver-time `pixi global install` resolution with a reviewed lockfile before scientific production or public release.
- [ ] Run real installation smoke tests on each supported platform/architecture and record the tested versions.

## Windows support (last)

- [ ] Add and validate Windows support through WSL2; native Windows execution is out of scope.
