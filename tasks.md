# Tasks

The annotation-transfer design is recorded in [`resources/concepts/done/annotation-transfer-workflow.md`](resources/concepts/done/annotation-transfer-workflow.md) and its results in [`resources/concepts/done/annotation-transfer-results.md`](resources/concepts/done/annotation-transfer-results.md). Ordered consensus work is indexed in [`resources/concepts/consensus/README.md`](resources/concepts/consensus/README.md); comparison and downstream workflows will receive separate plans when their contracts are discussed.

## Definition of done

Every task below includes proportionate unit tests in the same change. A task is not complete until its tests, `pnpm typecheck`, `pnpm build`, and `pnpm pack:local` pass. Add integration tests when they protect a meaningful cross-process, filesystem, package, or Snakemake contract; do not duplicate covered behavior merely because a thin injected wrapper crosses a boundary.

Implement the numbered sections in order as testable vertical slices. Add deeper contracts or infrastructure only when the current user-facing path needs them.

## 1. New-run command

- [x] Connect the existing `new-run` welcome-screen command in `src/ui/welcome-screen/commands/` to a dedicated new-run flow instead of showing `Coming soon`.
- [x] Allow the researcher to return from the new-run flow to the welcome screen without exiting the application.

## 2. Workflow discovery and selection

- [x] Add a manifest and parameter-definitions file for workflow ID `annotation-transfer`, with explicit schema and workflow versions plus a clear label and description.
- [x] Package and discover workflow manifests relative to the installed CLI rather than the current working directory.
- [x] Reject duplicate workflow IDs during discovery.
- [x] Present each discovered workflow's label and description in the new-run flow and persist the selection by stable ID.
- [x] Accept the packaged placeholder Snakefile during this slice; workflow selection must not imply that execution is available.

## 3. Annotation-transfer configuration form

- [x] Add file selection and direct path entry for the reference FASTA, matching reference GFF3, and target FASTA.
- [x] Add annotation-prefix entry with format validation and a preview of transformed IDs.
- [x] Add automatic, leave-one-free, and manual CPU allocation modes and record requested and effective values.
- [x] Add output-root, an optional run-name label saved verbatim, and an optional run-description field without allowing an existing run to be overwritten; record a `run.created_at` timestamp. Uniqueness comes from the generated `run.id`, not the name.
- [x] Declare the fixed same-species LiftOn profile in the manifest and saved configuration without exposing tuning controls in the TUI.
- [x] Save every effective option, including defaults, to the run configuration.
- [x] Show actionable input-validation errors before offering execution.
- [x] Present the resolved inputs, effective options, and output directory for confirmation.
- [x] Add an independent local-path/NCBI-accession source choice for the reference (FASTA+GFF3) and the target (FASTA), reusing the existing choice-plus-`visible_when` pattern; validate a versioned accession format (reject bare/unversioned accessions).
- [x] Show whether an NCBI API key is configured (configured/not-set only, never the value) among the effective options when an `ncbi` source is selected.
- [x] When an `ncbi` source's accession already has a cache entry under the chosen output root, ask the researcher to confirm reuse or force a fresh download before proceeding, and save that decision into `config.yaml`; skip the prompt when no cache entry exists.

## 4. Snakemake annotation-transfer workflow

- [x] Add small redistributable reference FASTA, reference GFF3, and target FASTA fixtures with known expected results.
- [x] Add a per-input resolve rule that normalizes a `local` or `ncbi` source into canonical checksummed `resolved/reference.fasta`, `resolved/reference.gff3`, and `resolved/target.fasta` outputs before any scientific rule runs.
- [x] Pin an `ncbi-datasets-cli` conda environment and fetch by accession with `datasets download genome accession <accession> --include genome[,gff3]`, reading an optional API key from the process environment (never interpolated into a logged `shell:` string) rather than invoking the tool directly from the TUI.
- [x] Cache NCBI downloads by accession under the run's output root; the resolve rule stays non-interactive and reads the TUI-saved `reuse`/`refresh` cache decision from `config.yaml` rather than deciding itself, verifies the cached file's checksum before reuse in `reuse` mode, and re-fetches on a checksum mismatch or in `refresh` mode.
- [x] Validate input readability, FASTA identifiers, GFF3 structure, reference sequence IDs, coordinates, IDs, and parent relationships before LiftOn runs.
- [x] Pin and install a LiftOn environment (`lifton==1.0.11`, `miniprot=0.18`, `minimap2=2.31`, `parasail-python=1.3.4`, and `python=3.11.16`) and verify real LiftOn end to end on the synthetic fixtures.
- [x] Replace the placeholder Snakefile with a LiftOn rule using Snakemake-managed `{threads}`, declared diagnostic outputs, logs, and benchmark data.
- [x] Preserve the raw LiftOn GFF3 and diagnostic outputs as immutable workflow artifacts.
- [x] Implement deterministic prefixing for the approved GFF3 identifier attributes without modifying descriptions or external references.
- [x] Test multi-valued parents, discontinuous features, collisions, and missing IDs (unit tests); verify with real LiftOn that a prefix-only rerun reuses its raw output — this caught and fixed a real bug: a params function taking `input`/`output` is not recorded in Snakemake's per-job metadata, so config-only changes silently failed to trigger reruns; all rules now use `wildcards`-only params functions with literal paths, or drop `params:` entirely where every argument is already a fixed literal.
- [x] Validate the prefixed GFF3 and emit structured errors and warnings.
- [x] Define run-ID validation and atomically create a unique, non-overwritten run workspace before producing run artifacts.
- [x] Define and emit a versioned JSON completion summary with a common envelope and a workflow-specific metrics payload; preserve a deterministic per-feature transfer TSV and direct links to the structured LiftOn evidence used for aggregation, and use explicit unavailable reasons only for metrics confirmed relevant to the pinned LiftOn release.
- [x] Define artifact and provenance records while recording commands, timestamps, effective resources, workflow and manifest versions, the full manifest checksum, tool versions, input/output checksums, effective configuration, and generated/imported/cached origin.
- [x] Verify direct Snakemake execution, failure handling, and resume independently of the TUI.

## Remaining commands

- [x] Check for releases in the background, show available updates in the TUI, and add a non-interactive `genopilot update` command that checks before installing.
- [x] Return to the home screen with `h` from any nested screen, without abandoning running work or stealing keys from text fields.
- [ ] Implement interactive and non-interactive help and version output.

## Workflow execution

- [x] Add dry-run previews and display the exact Snakemake command before execution.
- [x] Run workflows through the approved managed Snakemake environment rather than invoking scientific tools from TypeScript.
- [x] Define the minimal versioned event contract while implementing structured JSONL progress handling for pending, running, completed, and failed stages without parsing console text as workflow state.
- [x] Reuse the existing tooling-installation log view for live Snakemake output rather than creating a separate workflow log interface.
- [x] Capture complete Snakemake stdout and stderr separately from dashboard output and display their locations.

Cancellation is deferred to [`later.md`](later.md) "Workflow cancellation".

## Completion, loading, and comparison readiness

- [ ] Present completion status, start and finish times, total and per-stage duration, effective CPUs, validation counts, and available resource metrics in the TUI.
- [x] Present direct paths to the raw and prefixed GFF3 files, LiftOn diagnostics, machine-readable summaries, provenance, and complete logs.
- [x] List saved runs with readable researcher-facing metadata.
- [ ] Load and resume an incomplete annotation-transfer run without creating a conflicting output directory; verify that changing only the current manifest label or description does not prevent loading by stable workflow ID and version.
- [x] Load completed run summaries using their versioned schema and clearly identify incompatible or stale artifacts.
- [x] Count only protein-level changes (not `identical`) in the changed primary protein-coding metric and give every persisted metric definition an explicit unit.
- [x] Make result-screen labels state their counting unit and list the metrics JSON only once.
- [x] Add a scrollable result help page that explains every displayed metric, LiftOn transfer method, and mutation class.
- [ ] Define only the comparison-compatibility fields required to expose input checksums, workflow/tool versions, effective scientific parameters, and standardized metrics for two runs; defer browser visualization.

## Integration and packaging

- [ ] Add integration coverage for Snakemake success, failure, cancellation, and complete log retention using synthetic fixtures.
- [ ] Verify the packed CLI and bundled manifests in a clean temporary installation.

## Prerequisites and tooling maintenance

### Workflow contracts

- [x] Define a strict versioned workflow-manifest schema with separate `schema_version`, `workflow_version`, and stable unique `id`; mutable `label` and `description`; contained relative paths for the entry Snakefile and parameter-definitions file; ordered presentation stages; and artifacts. Keep the Snakefile authoritative for the execution DAG and defer interactive-decision fields until they are needed.
- [x] Define and validate the minimal versioned `annotation-transfer` configuration contract for three required absolute input paths, annotation prefix, CPU mode and optional manual limit, absolute output root, trimmed run name, and optional description. Keep advanced LiftOn options outside the first workflow.

### Tooling validation

- [x] Define a packaged tooling policy, including supported Node versions, pinned Pixi, Conda, and Snakemake versions, managed installation paths, download URLs, and per-platform checksums.
- [x] Validate detected tool versions against that policy instead of checking only whether `--version` succeeds.
- [x] Detect platform and architecture and check the application's managed tooling location.
- [x] Replace the current `Detected` state with `Ready` only after compatibility validation succeeds.
- [x] Distinguish missing, incompatible, timed-out, and failed individual tool checks and provide actionable diagnostics.
- [x] Implement the manual `Check tooling` action.
- [x] Move the ready tooling list from the welcome screen to a dedicated tooling screen with an explicit recheck action; keep the list prominent on the welcome screen only when setup is required.
- [ ] Save complete tooling-check logs outside the Ink render output; setup logs are already preserved.

### Tooling setup

- [x] Implement the `Set up tooling` screen and make it the only available action when compatible tooling is unavailable.
- [x] Offer an automatic user-local installation with explicit consent, displayed source/version/destination information, and verified downloads.
- [x] Stream and size-limit downloads, restrict archive extraction, sanitize the process environment, and use private filesystem permissions.
- [x] Prevent concurrent setup, propagate confirmed exit as cancellation, clean temporary files, and preserve setup logs.
- [x] Avoid `sudo` and never read or store an elevation password.
- [x] Revalidate the actual tooling installation on every CLI launch without relying on a saved completion marker.
- [x] Let the researcher enter, replace, and clear an optional NCBI API key; store it in a private (owner-only), user-local secrets file alongside the managed-tooling paths, never inside a run workspace or the repository, and never render it back in full.
- [x] Export the configured NCBI API key into the Snakemake process environment at run time rather than writing it into `config.yaml` or any `--config`/CLI argument.
- [ ] Replace solver-time bootstrap resolution with a reviewed lockfile before scientific production or public release.
- [ ] Run real installation smoke tests on each supported platform/architecture and record the tested versions.

## Later workflow capabilities

- [ ] Replace or extend provisional prefix-only annotation-ID rewriting with a reviewed regular-expression search-and-replacement step after raw LiftOn output, including previews, collision checks, provenance, and distinct raw/final IDs in reports.
- [ ] Evaluate advanced LiftOn controls only if baseline results demonstrate a need, including alignment coverage, sequence identity, extra-copy search, feature-type selection, and chromosome correspondence.
- [ ] Add manifests for the consensus and comparison workflows when their contracts are ready.
- [x] Implement isolate creation, editing, reuse, and lineage metadata management.
- [ ] Add continue-from-stage, rerun-stage, and presentation-mode actions beyond basic annotation-transfer resume.
- [ ] Implement explicit decision-boundary screens and save decisions before invoking dependent targets.

## Windows support (last)

- [ ] Add and validate Windows support through WSL2; native Windows execution is out of scope.
