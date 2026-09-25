"""Resolve the consensus backbone: normalize a `local` or `ncbi` source into
the canonical, checksummed `resolved/backbone.fasta` every later rule
consumes. Requires `SCRIPTS_DIR_SH` and `ENVS_DIR` to be defined by the
including Snakefile.

As in `resolve_inputs.smk`, the params function takes only `wildcards` and
repeats this rule's paths as literals, so a configuration-only change such
as an NCBI cache-mode switch is recorded in Snakemake's job metadata and
triggers a rerun.
"""

import shlex
from pathlib import Path


def _backbone_config():
    return config["inputs"]["backbone"]


def _backbone_input_files(wildcards):
    backbone = _backbone_config()
    return [backbone["fasta"]] if backbone["source"] == "local" else []


def _backbone_resolve_args(wildcards):
    backbone = _backbone_config()
    args = [
        "--role",
        "backbone",
        "--source-type",
        backbone["source"],
        "--fasta-destination",
        "resolved/backbone.fasta",
        "--fasta-provenance",
        "provenance/backbone.fasta.json",
    ]
    if backbone["source"] == "local":
        args += ["--local-fasta", backbone["fasta"]]
    else:
        args += [
            "--accession",
            backbone["accession"],
            "--cache-dir",
            str(Path(config["run"]["output_root"]) / "ncbi-accessions-cache"),
            "--cache-mode",
            backbone.get("ncbi_cache_mode", "reuse"),
        ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule resolve_backbone:
    input:
        _backbone_input_files,
    output:
        fasta="resolved/backbone.fasta",
        fasta_provenance="provenance/backbone.fasta.json",
    log:
        "logs/resolve-backbone.log",
    params:
        args=_backbone_resolve_args,
    conda:
        str(ENVS_DIR / "ncbi-datasets-cli" / "environment.yaml")
    shell:
        "python3 {SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"
