"""Resolve the annotation-transfer inputs into canonical, checksummed files.

What it does
  The reference (genome + annotation) and the target (genome) each come from
  a local file or a versioned NCBI assembly accession. Both sources end up
  as the same files, so no later step needs to know where an input came
  from:

    resolve_reference  -> resolved/reference.fasta, resolved/reference.gff3
    resolve_target     -> resolved/target.fasta

  A local file is copied into the run directory. An NCBI accession is
  downloaded with the NCBI Datasets CLI into a cache shared by all runs
  (<output_root>/ncbi-accessions-cache/) and copied from there. Whether an
  existing cache entry is reused (only after its checksum matches) or
  downloaded again was decided in GenoPilot and saved as `ncbi_cache_mode`
  in config.yaml; the rule never asks.

  Each resolved file gets a record in provenance/<file>.json: its SHA-256
  checksum, its source path or accession, and for NCBI downloads the
  Datasets CLI version.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `ENVS_DIR` from the including Snakefile.
  The params functions take only `wildcards` and repeat this rule's paths
  as literals: Snakemake does not record a params function that takes
  `input` or `output` in its job metadata (confirmed against the pinned
  release), so a configuration-only change such as switching the cache
  mode would silently not trigger a rerun.
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
