# Annotation-transfer workflow: design

## Purpose

This document records the design of the first workflow, `annotation-transfer`, together with the generic workflow-manifest, run-workspace, provenance, and metrics contracts it established for later workflows. All increments below are implemented; it is kept for reference. Result presentation is recorded separately in [`annotation-transfer-results.md`](annotation-transfer-results.md), and the next workflows in [`../consensus-and-comparison-workflows.md`](../consensus-and-comparison-workflows.md).

## Workflow identity, versioning, and presentation

Every workflow manifest separates identity, contract versioning, and presentation:

- `schema_version`: the version of the manifest format and its validation rules;
- `workflow_version`: the version of the workflow's behavior and scientific contract;
- `id`: a stable, unique, machine-readable identifier such as `annotation-transfer`; it is used in configuration, saved runs, artifact metadata, and internal references and must not change when presentation text changes;
- `label`: a concise, human-readable name shown by the TUI; it may be revised without invalidating existing runs;
- `description`: a more detailed explanation of the workflow's purpose, required inputs, and principal outputs so researchers can understand workflows whose scope is not clear from the label alone.

The TUI presents the label and description during workflow selection but persists and resolves the workflow by ID. Reject duplicate IDs during workflow discovery. A label or description change must not prevent an existing run from being loaded. Saved runs record the workflow ID, workflow version, manifest schema version, and a full manifest checksum for provenance. Compatibility uses the workflow ID and workflow version; presentation-only edits do not change either. Any execution-relevant or scientific contract change must increment the workflow version.

## Workflow design

The first production workflow is a self-contained annotation transfer from an annotated reference assembly to a new target assembly. It establishes the reusable workflow, run, logging, provenance, and result-summary contracts needed by later workflows without attempting to implement the complete consensus pipeline at once. Its initial scope ends with transferred-GFF3 validation and transfer metrics; CDS extraction and protein validation extend the reusable annotation pipeline in later core work rather than blocking this first workflow.

### Manifest

The workflow manifest uses a stable ID independently of its presentation text:

```yaml
schema_version: 1
workflow_version: 1
id: annotation-transfer
label: Transfer genome annotation
description: >
  Transfer a GFF3 annotation from a reference genome to a target genome with
  LiftOn, apply a configured identifier prefix, validate the resulting GFF3,
  and report transfer and execution metrics.
```

The manifest also identifies its entry Snakefile, external `manifest.parameters.yaml` parameter definitions, ordered stages, and artifacts. Schema version 1 does not define interactive decisions; that contract will be designed iteratively if a workflow needs it, as noted in [`later.md`](../../../later.md). Stage and artifact IDs are unique within a manifest, and artifacts reference known producing stages. Manifest paths are normalized relative paths contained within the packaged workflow directory; absolute paths, parent traversal, surrounding whitespace, and control characters are invalid. Unknown fields are rejected for a supported schema version so misspellings cannot silently alter behavior.

Manifest stages describe presentation and progress grouping only. The file referenced by `parameter-definitions` declares each parameter's section, label, input kind, required status, default, placeholder, optional preview, choice options, conditional display rule, and whether it is hidden; a parameter is visible unless `hidden: true` is explicit. The fixed same-species LiftOn profile is retained there for provenance but hidden from the configuration TUI. The Snakefile remains the authority for dependencies and execution, and the TUI must not infer or implement a second DAG from the stage list. A future label or description change must not change the workflow ID or version and must not prevent old runs from loading.

### TUI flow and configuration

For a new run, the researcher:

1. selects the workflow and reads its description;
2. for the reference and, independently, the target, chooses a local path or an NCBI assembly accession;
3. enters an annotation-ID prefix;
4. selects automatic CPU allocation, all but one available CPU, or a manual limit;
5. chooses an output root, optionally adds a short run-name label always saved with a leading timestamp prefix, and adds an optional description;
6. reviews validated inputs, effective options, the output path, and the exact Snakemake command;
7. reviews a successful dry run before starting execution;
8. follows structured stage progress and the existing reusable live-log view while Snakemake runs;
9. receives completion metrics and paths to the produced artifacts.

The first workflow uses one same-species LiftOn profile and does not expose advanced LiftOn controls. Extra-copy search, feature-type selection, alignment-coverage and sequence-identity thresholds, chromosome correspondence, and other tuning are deferred to [`later.md`](../../../later.md). Resolve selected input and output paths to absolute paths before validating and saving the effective configuration so execution never depends on the caller's working directory. After the LiftOn release is pinned, record its effective defaults in provenance so a tool upgrade cannot change a run silently.

Snakemake owns total CPU scheduling. The TUI translates the selected CPU mode into `--cores`, records the requested and effective values, and each rule passes only its allocated `{threads}` to its tool. LiftOn receives `-t {threads}` and must not independently claim every system CPU.

### Input resolution

The reference (FASTA + GFF3) and the target (FASTA) are each configured with an independent source: `local`, requiring an already-existing absolute path, or `ncbi`, requiring a versioned assembly accession (for example `GCF_000149205.2`; a bare, unversioned accession is rejected so the same accession cannot silently resolve to different bytes later). The TUI presents the same local-path/accession choice for reference and target using the existing choice-plus-`visible_when` pattern already used for CPU allocation; no new parameter kind is needed.

A per-input resolve rule normalizes both sources into the same canonical, checksummed output before any scientific rule runs, so LiftOn and downstream validation only ever consume `resolved/reference.fasta`, `resolved/reference.gff3`, and `resolved/target.fasta` and never know which source produced them:

- `local` source: copy the given path and record its checksum.
- `ncbi` source: run `datasets download genome accession <accession> --include genome[,gff3]` in a pinned `ncbi-datasets-cli` conda environment (declared like any other rule-specific environment; the TUI never installs or invokes it directly), unpack, rename to the canonical filename, and record the checksum.

NCBI downloads are cached by accession under the selected output root (for example `<output_root>/ncbi-accessions-cache/<accession>/`) rather than re-fetched by every run, and the cache is preferred by default. The Snakemake resolve rule stays non-interactive: it never itself decides whether to reuse or refresh. Instead, while configuring the run, the TUI checks whether a cache entry already exists for the chosen accession and, if so, asks the researcher to confirm reuse or force a fresh download; that decision is saved into the run's `config.yaml` (for example `reference.ncbi_cache_mode: reuse | refresh`) alongside the other explicit decisions the TUI already saves before invoking Snakemake. The resolve rule reads that saved mode: `reuse` verifies the cached file's checksum and re-fetches only on a checksum mismatch (data-integrity fallback, not a preference); `refresh` always re-downloads and updates the cache entry. A missing cache entry always downloads regardless of mode. Provenance for a resolved input records its source (`local`/`ncbi`), the accession when applicable, the cache decision when applicable, the `datasets` CLI version, retrieval timestamp, and checksum, with origin `imported`.

An optional NCBI API key raises the Datasets CLI's rate limit. Because it is a credential, it must never be embedded in workflow code, `config.yaml`, or provenance (see the privacy rules in `AGENTS.md`), and it must never appear in a logged or displayed exact command, so it cannot be interpolated into a rule's `shell:` string via `params:` — the rule must reference the environment variable name (for example `--api-key "$NCBI_API_KEY"`) and let the child shell expand it at execution time. The TUI stores the key, once entered, in a user-local secrets file alongside the existing managed-tooling paths (`resolveToolingPaths`), permission-restricted like a private key and never rendered back in full; it is exported into the Snakemake process environment at run time and shown in the confirmation screen only as configured/not-set, never by value. Entry point and exact file layout are implementation details, not part of this design.

### Workflow DAG

```text
reference source + target source
    -> resolve inputs (local copy or NCBI fetch by accession) and checksum
    -> validate paths and formats
    -> validate the reference FASTA/GFF3 relationship
    -> run LiftOn
    -> preserve the raw LiftOn GFF3 and diagnostic outputs
    -> prefix GFF3 IDs and identifier references deterministically, when a prefix is configured
    -> validate the transferred GFF3
    -> collect execution and annotation-transfer metrics
    -> write the TUI completion summary
```

Prefixing updates identifier fields such as `ID`, `Parent`, and `Derives_from` rather than replacing arbitrary text. Preserve descriptions and external references. Define and test the exact attribute allowlist, multi-valued parents, discontinuous features, collision detection, and features without IDs. Changing only the prefix must reuse the LiftOn result and rerun prefixing and dependent stages. The prefix is optional: without one there is nothing to rewrite, so the prefixing rule is not part of the DAG at all and no `lifton.prefixed.gff3` is written — validation and every later stage read the raw LiftOn GFF3 instead, rather than a copy whose name promises a prefix it does not carry.

### Isolated run workspace

Every new execution uses a unique directory and never overwrites another run. The shared `ncbi-accessions-cache/` described in [Input resolution](#input-resolution) lives beside `runs/` under the output root, not inside any individual run directory; it is a checksum-verified cache, not a source of run-to-run difference, since a run's own provenance always records the checksum it resolved against:

```text
runs/<run-id>/
├── config.yaml
├── artifacts.yaml
├── events.jsonl
├── logs/
├── provenance/
└── results/
    ├── annotation/
    │   ├── lifton.raw.gff3
    │   └── lifton.prefixed.gff3   # only when an ID prefix is configured
    ├── lifton-output/
    ├── validation.json
    ├── metrics.json
    └── summary.json
```

Resume continues an incomplete run in place; a changed experiment creates a new run ID. Record the workflow ID, workflow version, manifest schema version, full manifest checksum, absolute input paths and checksums, effective configuration, commands, tool versions, timestamps, requested and effective resources, artifact checksums, and generated/imported/cached origin.

“Immutable” raw LiftOn artifacts means that downstream rules never modify them in place, their checksums are recorded, and prefix-only changes reuse them. Changed LiftOn inputs or scientific parameters require a new run, or an explicitly requested rerun whose replacement artifacts and provenance are recorded; filesystem-level immutability is not required.

The execution screen reuses the existing tooling-installation log view instead of introducing a second presentation. Complete Snakemake stdout and stderr and per-stage logs remain on disk after success, failure, or cancellation. Structured Snakemake events, not parsed console text, determine stage state.

### Completion and comparison-ready metrics

The TUI completion view reports status, start and finish times, total and per-stage duration, requested and effective CPUs, resource metrics where available, validation results, and direct paths to the raw GFF3, prefixed GFF3, LiftOn diagnostics, provenance, and logs.

A versioned JSON summary, with optional versioned JSON or TSV detail tables, reports reference and transferred feature counts by type, mapped and unmapped features, extra copies, miniprot rescues, changed protein-coding models, protein-identity summaries, LiftOn mutation classifications, prefix transformations, and GFF3 validation warnings or errors when available from the pinned toolchain. Use a common summary envelope with a separately versioned workflow-specific metrics payload. Metrics unavailable from the pinned LiftOn release are represented explicitly as unavailable with a reason rather than guessed, silently omitted, or derived from unstable console text. Finalize detailed LiftOn metric fields only after verifying the pinned release and its declared output formats.

Consistent schemas and isolated run directories make completed runs comparable. Comparison must show input checksums, workflow and tool versions, and effective scientific parameters so incompatible runs are not presented as directly equivalent. Browser-based HTML reports remain deferred; the first workflow presents metrics in the TUI and preserves machine-readable summaries.

### Incremental delivery

This workflow is intentionally split across multiple implementation sessions. [`tasks.md`](../../../tasks.md) is the authoritative execution order and definition-of-done tracker. Define each persisted contract when the first concrete producer or consumer needs it rather than designing every later contract up front:

1. define and validate the generic workflow-manifest contract;
2. define the minimal versioned `annotation-transfer` configuration contract for required inputs, prefix, CPU selection, and run location/identity, without advanced LiftOn options;
3. add the concrete manifest, parameter definitions, synthetic FASTA/GFF3 fixtures, and direct-Snakemake contract tests;
4. implement input validation and the minimal LiftOn rule with a pinned environment;
5. implement deterministic prefixing and GFF3 validation;
6. implement run workspaces, provenance, benchmarks, artifact records, metrics, and summary contracts alongside their concrete outputs;
7. add generic packaged-manifest discovery and workflow selection to the TUI, rejecting duplicate IDs at discovery time;
8. add configuration screens, dry-run review, and execution through the managed Snakemake runtime;
9. define structured events alongside progress handling, cancellation, and the existing live-log view;
10. add completion metrics, artifact presentation, resume, and comparison-compatible run loading, including a test that presentation-only manifest changes do not prevent loading by stable workflow ID and version.

Each increment must include its own tests and leave direct Snakemake execution usable. HTML reporting is not part of these increments.
