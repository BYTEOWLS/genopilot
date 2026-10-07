"""Summarize the annotation transfer: per-feature table, metrics, and completion summary.

What it does
  Reports which reference features were transferred, where they landed on
  the target, how LiftOn mapped them, their DNA and protein identity, and
  their mutation classes, rates each coding gene's protein and lists the
  genes to review, then aggregates these into metrics. Everything is
  read from LiftOn's structured reports and the GFF3 files; console output
  of LiftOn or Snakemake is never parsed.

  Reads:  resolved/reference.gff3, resolved/target.fasta,
          results/annotation/lifton.raw.gff3, results/validation.json,
          results/annotation/lifton_output/
  Writes: results/feature-transfer.tsv - one row per reference feature and target copy
          results/metrics.json         - aggregated counts and fractions, each with its definition
          results/target-unresolved.bed - the target's intervals of bases that are not A, C, G, or T
          results/summary.json         - versioned completion summary of the run, read by
                                         GenoPilot's results screen

  The minimum protein identity is a parameter of this step only, so changing
  it reruns this step and reuses LiftOn's results.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` from the including Snakefile. The params
  function takes only `wildcards`; see resolve_inputs.smk for why.
"""

import shlex


def _summarize_results_args(wildcards):
    args = [
        "--reference-gff3",
        "resolved/reference.gff3",
        "--raw-gff3",
        "results/annotation/lifton.raw.gff3",
        "--validation",
        "results/validation.json",
        "--target-fasta",
        "resolved/target.fasta",
        "--minimum-protein-identity",
        config["review"]["minimum_protein_identity"],
        "--unresolved-bed",
        "results/target-unresolved.bed",
        "--diagnostics",
        "results/annotation/lifton_output",
        "--details",
        "results/feature-transfer.tsv",
        "--metrics",
        "results/metrics.json",
        "--summary",
        "results/summary.json",
        "--workflow-id",
        config["workflow_id"],
        "--workflow-version",
        config["workflow_version"],
        "--run-id",
        config["run"]["id"],
        "--run-created-at",
        config["run"]["created_at"],
        "--effective-cpus",
        config["resources"]["effective_cpus"],
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule summarize_annotation_transfer:
    input:
        reference_gff3="resolved/reference.gff3",
        target_fasta="resolved/target.fasta",
        raw_gff3="results/annotation/lifton.raw.gff3",
        validation="results/validation.json",
        diagnostics="results/annotation/lifton_output",
    output:
        details="results/feature-transfer.tsv",
        metrics="results/metrics.json",
        summary="results/summary.json",
        unresolved_bed="results/target-unresolved.bed",
    log:
        "logs/summarize-results.log",
    params:
        args=_summarize_results_args,
    shell:
        "{PYTHON_SH} {SCRIPTS_DIR_SH}/collect_transfer_metrics.py {params.args} > {log} 2>&1"
