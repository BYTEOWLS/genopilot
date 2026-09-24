# Task 3 — Workflow configuration and review

## Goal

Add the packaged reference-consensus workflow manifest and a configuration flow that selects one backbone and one or more pre-existing isolates, saves every effective scientific choice, and reviews the exact run before execution.

This task depends on Tasks 1 and 2. Its kickoff finalizes the minimal scientific configuration fields and supported ploidy needed by Task 4.1; Task 4.1 then selects and pins tools that implement this persisted contract. It configures and validates the run but may use a visibly unavailable placeholder execution target until Task 4.1 lands.

## Configuration flow

1. Select the workflow by stable ID and read its description.
2. Select the backbone from:
   - a typed local FASTA path;
   - the local file chooser;
   - one entry from **Manage accessions**.
3. Multi-select isolates from **Manage isolates**. The count is derived from the selected IDs; there is no numeric count field.
4. Select the voting method:
   - `strict-majority`: the winner must receive more than half of votes cast;
   - `plurality`: the unique highest vote count wins.
5. Configure the reviewed per-isolate callability/calling settings agreed at this task's kickoff.
6. Configure CPUs, output root, run name, and description using the established run controls.
7. Review resolved inputs, lineage, generated command, and output directory before saving or executing.

The visible default voting method is `strict-majority`, and the effective value is always saved. Both methods leave a tie for first place unresolved.

## Persisted run snapshot

The run stores stable isolate IDs in `config.yaml` and copies their selected catalog records into `isolates.yaml`. The snapshot resolves read paths to absolute paths and is immutable for the run. Later edits to the user-local catalog cannot alter or invalidate what an old run claims to have used.

A conceptual configuration shape is:

```yaml
schema_version: 1
workflow_id: reference-consensus
workflow_version: 1
inputs:
  backbone:
    source: ncbi
    accession: GCF_000149205.2
    ncbi_cache_mode: reuse
  isolates_file: isolates.yaml
  selected_isolates:
    - isolate-a
    - isolate-b
consensus:
  include_backbone_vote: true
  voting_method: strict-majority
resources:
  cpu_mode: automatic
  effective_cpus: 8
run:
  output_root: /analysis/genopilot
  id: 2026-01-01_120000000_example
  created_at: 2026-01-01T12:00:00.000Z
```

The stable workflow ID remains provisional until this task begins. Finalize it before releasing a manifest or persisted configuration.

## Review screen

Show:

- backbone name, source, versioned accession where applicable, path/cache decision, and known checksum;
- selected isolate names and stable IDs, derived count, R1/R2 filenames, wild-type status, and lineage;
- warnings for unavailable reads, duplicated paths, or a possible duplicate of the biological sample used for the backbone;
- voting-method explanation with a compact example;
- all effective scientific and resource parameters;
- run directory and exact Snakemake command;
- NCBI API key as configured/not set only when needed.

Generated isolate genomes already in the catalog are informative but are not substituted for the selected raw reads in a fresh run. Continue-from-artifact behavior belongs to a later explicit compatibility design.

## Work

- [ ] Finalize the stable workflow ID, supported ploidy, minimal scientific fields/defaults, manifest, configuration schema, and parameter definitions.
- [ ] Add backbone choice using local entry, file chooser, or accession catalog.
- [ ] Add searchable isolate multi-selection and derived count, requiring at least one isolate.
- [ ] Add the required strict-majority/plurality single select with help text.
- [ ] Snapshot selected isolate metadata atomically into the new run workspace.
- [ ] Validate all paths, IDs, source choices, cache decisions, and effective values before review.
- [ ] Present the exact command and run a Snakemake dry run through the established execution path.
- [ ] Add tests for empty catalogs, returning from each manager, preserving selections, conditional fields, stale entries, review, saving, resizing, and direct configuration parsing.

## Acceptance

A researcher with cataloged isolates can configure a self-describing run without re-entering isolate paths or a numeric count. The same saved `config.yaml` and `isolates.yaml` can be supplied directly to Snakemake without the TUI.
