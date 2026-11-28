"""Copy local inputs or consume provider files under the shared cache lease.

Saved references, cache decisions, and optional cross-root snapshots are passed
unchanged to the packaged resolver. Params functions take only wildcards so
configuration changes are recorded in Snakemake's job metadata.
"""

import json
import shlex


# Register the capacity here so direct Snakemake runs need no extra CLI option.
workflow.register_resource("shared_genome_cache", 1)


def _shared_genome_cache(wildcards):
    reference = config["inputs"]["reference"]
    target = config["inputs"]["target"]
    return int(
        reference["source"] == target["source"] == "remote"
        and reference["reference"]["source"] == target["reference"]["source"]
        and reference["reference"]["id"] == target["reference"]["id"]
    )


def _reference_input_files(wildcards):
    reference = config["inputs"]["reference"]
    return [reference["fasta"], reference["gff3"]] if reference["source"] == "local" else []


def _target_input_files(wildcards):
    target = config["inputs"]["target"]
    return [target["fasta"]] if target["source"] == "local" else []


def _reference_resolve_args(wildcards):
    args = [
        "--role", "reference",
        "--input-json", json.dumps(config["inputs"]["reference"], sort_keys=True),
        "--output-root", config["run"]["output_root"],
        "--fasta-destination", "resolved/reference.fasta",
        "--fasta-provenance", "provenance/reference.fasta.json",
        "--gff3-destination", "resolved/reference.gff3",
        "--gff3-provenance", "provenance/reference.gff3.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


def _target_resolve_args(wildcards):
    args = [
        "--role", "target",
        "--input-json", json.dumps(config["inputs"]["target"], sort_keys=True),
        "--output-root", config["run"]["output_root"],
        "--fasta-destination", "resolved/target.fasta",
        "--fasta-provenance", "provenance/target.fasta.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule resolve_reference:
    input:
        _reference_input_files,
    output:
        fasta="resolved/reference.fasta",
        gff3="resolved/reference.gff3",
        fasta_provenance="provenance/reference.fasta.json",
        gff3_provenance="provenance/reference.gff3.json",
    log:
        "logs/resolve-reference.log",
    params:
        args=_reference_resolve_args,
    resources:
        shared_genome_cache=_shared_genome_cache,
    shell:
        "{PYTHON_SH} {SHARED_SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"


rule resolve_target:
    input:
        _target_input_files,
    output:
        fasta="resolved/target.fasta",
        fasta_provenance="provenance/target.fasta.json",
    log:
        "logs/resolve-target.log",
    params:
        args=_target_resolve_args,
    resources:
        shared_genome_cache=_shared_genome_cache,
    shell:
        "{PYTHON_SH} {SHARED_SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"
