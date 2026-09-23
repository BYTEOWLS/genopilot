"""Record checksummed artifacts and run-level annotation-transfer provenance.

This final producer-side rule keeps direct Snakemake execution self-describing;
the TUI is only a future reader of these persisted records. Requires
`SCRIPTS_DIR_SH`, `ENVS_DIR`, `WORKFLOW_DIR`, and `ANNOTATION_GFF3` from the
including Snakefile.
"""

import importlib.metadata
import json
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
        "--artifacts",
        "artifacts.yaml",
        "--provenance",
        "provenance/run.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


def _provenance_inputs(wildcards):
    paths = [
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
        ANNOTATION_GFF3,
        "results/validation.json",
        "results/feature-transfer.tsv",
        "results/metrics.json",
        "results/summary.json",
        "logs/resolve-reference.log",
        "logs/resolve-target.log",
        "logs/validate-inputs.log",
        "logs/transfer-annotation.log",
        "logs/transfer-annotation.benchmark.tsv",
        "logs/validate-annotation.log",
        "logs/summarize-results.log",
    ]
    if config["annotation"]["id_prefix"]:
        paths.append("logs/prefix-annotation.log")
    return paths


rule record_annotation_transfer_provenance:
    input:
        _provenance_inputs,
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
