"""Resolve a local or provider backbone, recording copied bytes and provider facts.

The packaged Node/Python bridge holds the cache lease through copying. Params
functions take only wildcards so configuration changes trigger a rerun.
"""

import json
import shlex


def _backbone_input_files(wildcards):
    backbone = config["inputs"]["backbone"]
    return [backbone["fasta"]] if backbone["source"] == "local" else []


def _backbone_resolve_args(wildcards):
    args = [
        "--role", "backbone",
        "--input-json", json.dumps(config["inputs"]["backbone"]),
        "--output-root", config["run"]["output_root"],
        "--fasta-destination", "resolved/backbone.fasta",
        "--fasta-provenance", "provenance/backbone.fasta.json",
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
    shell:
        "{PYTHON_SH} {SHARED_SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"
