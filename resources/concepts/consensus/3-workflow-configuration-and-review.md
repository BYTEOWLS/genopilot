# Task 3 — Workflow configuration and review

## Goal

Add the packaged reference-consensus workflow manifest and a configuration flow that selects one backbone and one or more pre-existing isolates, saves every effective scientific choice, and reviews the exact run before execution.

This task depends on Tasks 1 and 2. Its kickoff finalizes the minimal scientific configuration fields and supported ploidy needed by Task 4.1; Task 4.1 then selects and pins tools that implement this persisted contract. It configures and validates the run but may use a visibly unavailable placeholder execution target until Task 4.1 lands.

## Kickoff decisions

- The stable workflow ID is `reference-consensus`, packaged under `workflows/reference-consensus/` with `workflow_version: 1` and configuration `schema_version: 1`.
- Only haploid calling is supported. `calling.ploidy: 1` is saved but not editable.
- The per-isolate thresholds are editable, and every effective value is saved:

  | Field | Default | Allowed |
  |---|---|---|
  | `min_depth` | 10 | integer ≥ 1 |
  | `min_mapping_quality` | 20 | integer ≥ 0 |
  | `min_base_quality` | 20 | integer ≥ 0 |
  | `min_allele_fraction` | 0.8 | greater than 0.5 and at most 1, so a haploid call has a single winner |

  Task 4.1 maps them onto the tools it selects.
- `consensus.include_backbone_vote` is a visible yes/no choice, default yes, and is always saved. With it off, only callable isolates vote and the backbone supplies only the coordinates; Task 4.3 defines how unresolved sites and positions without any vote are represented.
- The backbone is either a local FASTA (no GFF3) or a versioned NCBI accession with a saved reuse/refresh cache decision.
- A selected read file that is missing, unreadable, or not FASTQ blocks the run before review, as does an unreadable local backbone. The review warns about the rest: one file behind several read paths, a possible duplicate of the backbone's sample, and mixed trimming.
- The possible backbone-sample duplicate is detected when an isolate's name or ID matches the backbone's NCBI strain, or a local backbone's file name, ignoring case and punctuation.
- Until Task 4.1, the Snakefile resolves the backbone (`resolve_backbone`) and validates the backbone FASTA and the snapshot's read files (`validate_run_inputs`). A dry run works from the TUI; execution is listed as not available there. Direct Snakemake execution runs both rules.

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
7. Review resolved inputs, lineage, and output directory before saving; the exact command is shown on the start page before any run.

The visible default voting method is `strict-majority`, and the effective value is always saved. Both methods leave a tie for first place unresolved.

## Persisted run snapshot

The run stores stable isolate IDs in `config.yaml` and copies their selected catalog records into `isolates.yaml`. The snapshot includes every selected read pair with its `trimmed` flag, resolves read paths to absolute paths, and is immutable for the run. Later edits to the user-local catalog cannot alter or invalidate what an old run claims to have used.

The configuration shape is:

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
calling:
  ploidy: 1
  min_depth: 10
  min_mapping_quality: 20
  min_base_quality: 20
  min_allele_fraction: 0.8
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

`isolates.yaml` holds `schema_version: 1`, the `captured_at` timestamp, and the selected catalog records in selection order. The Snakefile refuses a snapshot whose isolates differ from `selected_isolates`.

## Review screen

Show:

- backbone name, source, versioned accession where applicable, path/cache decision, and known checksum;
- selected isolate names and stable IDs, derived count, read-pair count and R1/R2 filenames, trimmed status (untrimmed, trimmed, or partly trimmed), wild-type status (yes, no, or not recorded), and lineage;
- warnings for unavailable reads, duplicated paths, a possible duplicate of the biological sample used for the backbone, and a selection that mixes trimmed and untrimmed reads within or across isolates, because the cohort would then not be processed consistently;
- voting-method explanation with a compact example;
- all effective scientific and resource parameters;
- run directory (the exact Snakemake command follows on the start page, before a run begins);
- NCBI API key as configured/not set only when needed.

Generated isolate genomes already in the catalog are informative but are not substituted for the selected raw reads in a fresh run. Continue-from-artifact behavior belongs to a later explicit compatibility design.

## Work

- [x] Finalize the stable workflow ID, supported ploidy, minimal scientific fields/defaults, manifest, configuration schema, and parameter definitions.
- [x] Add backbone choice using local entry, file chooser, or accession catalog; refuse a cataloged accession whose verified copies conflict.
- [x] Add searchable isolate multi-selection and derived count, requiring at least one isolate.
- [x] Add the required strict-majority/plurality single select with help text.
- [x] Snapshot selected isolate metadata, including every read pair and its `trimmed` flag, atomically into the new run workspace.
- [x] Warn in review when the selected isolates mix trimmed and untrimmed reads.
- [x] Validate all paths, IDs, source choices, cache decisions, and effective values before review.
- [x] Present the exact command and run a Snakemake dry run through the established execution path.
- [x] Add tests for empty catalogs, returning from each manager, preserving selections, conditional fields, stale entries, review, saving, resizing, and direct configuration parsing.

## Acceptance

A researcher with cataloged isolates can configure a self-describing run without re-entering isolate paths or a numeric count. The same saved `config.yaml` and `isolates.yaml` can be supplied directly to Snakemake without the TUI.
