"""Record the run's provenance: what was produced, from what, and with which tools.

What it does
  Runs last, so a finished run describes itself without GenoPilot:

  Writes: artifacts.yaml      - every input, result, and log with its SHA-256 checksum, the
                                step that produced it, and whether it was generated or
                                imported
          provenance/run.json - the effective configuration, workflow and manifest versions
                                (with the manifest's checksum), the Snakemake version,
                                pinned and observed tool versions, the command each step
                                ran, and the effective resources

  It runs in the LiftOn environment so it can read the versions of the
  LiftOn packages that were actually installed.

Maintainer notes
  Requires `SCRIPTS_DIR_SH`, `ENVS_DIR`, and `WORKFLOW_DIR` from the
  including Snakefile. Depending on every file it records keeps this rule
  last in the DAG.
"""

import importlib.metadata
import json
import platform
import shlex


def _record_provenance_args(wildcards):
    args = [
        "--config-json",
        json.dumps(config, sort_keys=True, separators=(",", ":")),
        "--manifest",
        str(WORKFLOW_DIR / "manifest.yaml"),
        "--manifest-schema-version",
        1,
        "--snakemake-version",
        importlib.metadata.version("snakemake"),
        "--snakemake-python-version",
        platform.python_version(),
        "--artifacts",
        "artifacts.yaml",
        "--provenance",
        "provenance/run.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule record_annotation_transfer_provenance:
    input:
        str(WORKFLOW_DIR / "manifest.yaml"),
        "resolved/reference.fasta",
        "resolved/reference.gff3",
        "resolved/target.fasta",
        "provenance/reference.fasta.json",
        "provenance/reference.gff3.json",
        "provenance/target.fasta.json",
        "results/input-validation.json",
        "results/annotation/lifton.raw.gff3",
        "results/annotation/lifton_output",
        "results/validation.json",
        "results/feature-transfer.tsv",
        "results/metrics.json",
        "results/summary.json",
        "results/target-unresolved.bed",
        "logs/resolve-reference.log",
        "logs/resolve-target.log",
        "logs/validate-inputs.log",
        "logs/transfer-annotation.log",
        "logs/transfer-annotation.benchmark.tsv",
        "logs/validate-annotation.log",
        "logs/summarize-results.log",
    output:
        artifacts="artifacts.yaml",
        provenance="provenance/run.json",
    log:
        "logs/record-provenance.log",
    params:
        args=_record_provenance_args,
    conda:
        str(ENVS_DIR / "lifton" / "environment.yaml")
    shell:
        "python3 {SCRIPTS_DIR_SH}/collect_run_provenance.py {params.args} > {log} 2>&1"
