"""Per-input resolve rules: normalize a `local` or `ncbi` source into the
canonical, checksummed `resolved/` files every later rule consumes, so
LiftOn and downstream validation never know which source produced them.
Requires `SCRIPTS_DIR_SH` and `ENVS_DIR` to be defined by the including
Snakefile.

Params functions here deliberately take only `wildcards` and reference
this rule's own `input:`/`output:` paths as literals, rather than
Snakemake's `input`/`output` objects: a params function with an
`input`/`output` parameter is not recorded in Snakemake's per-job metadata
(confirmed against the pinned Snakemake release), so a config-only change
(e.g. an NCBI cache-mode switch) would silently fail to trigger a rerun.
"""

import shlex
from pathlib import Path


def _reference_config():
    return config["inputs"]["reference"]


def _target_config():
    return config["inputs"]["target"]


def _ncbi_cache_dir():
    return str(Path(config["run"]["output_root"]) / "ncbi-accessions-cache")


def _reference_input_files(wildcards):
    reference = _reference_config()
    if reference["source"] == "local":
        return [reference["fasta"], reference["gff3"]]
    return []


def _target_input_files(wildcards):
    target = _target_config()
    if target["source"] == "local":
        return [target["fasta"]]
    return []


def _reference_resolve_args(wildcards):
    reference = _reference_config()
    args = [
        "--role",
        "reference",
        "--source-type",
        reference["source"],
        "--fasta-destination",
        "resolved/reference.fasta",
        "--fasta-provenance",
        "provenance/reference.fasta.json",
        "--gff3-destination",
        "resolved/reference.gff3",
        "--gff3-provenance",
        "provenance/reference.gff3.json",
    ]
    if reference["source"] == "local":
        args += ["--local-fasta", reference["fasta"], "--local-gff3", reference["gff3"]]
    else:
        args += [
            "--accession",
            reference["accession"],
            "--cache-dir",
            _ncbi_cache_dir(),
            "--cache-mode",
            reference.get("ncbi_cache_mode", "reuse"),
        ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


def _target_resolve_args(wildcards):
    target = _target_config()
    args = [
        "--role",
        "target",
        "--source-type",
        target["source"],
        "--fasta-destination",
        "resolved/target.fasta",
        "--fasta-provenance",
        "provenance/target.fasta.json",
    ]
    if target["source"] == "local":
        args += ["--local-fasta", target["fasta"]]
    else:
        args += [
            "--accession",
            target["accession"],
            "--cache-dir",
            _ncbi_cache_dir(),
            "--cache-mode",
            target.get("ncbi_cache_mode", "reuse"),
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
    conda:
        str(ENVS_DIR / "ncbi-datasets-cli" / "environment.yaml")
    shell:
        "python3 {SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"


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
    conda:
        str(ENVS_DIR / "ncbi-datasets-cli" / "environment.yaml")
    shell:
        "python3 {SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"
