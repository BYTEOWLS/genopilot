"""Resolve the consensus backbone into a canonical, checksummed FASTA.

What it does
  The backbone is the assembly every isolate's reads are called against. It
  comes from a local FASTA or a versioned NCBI assembly accession; both end
  up as the same file:

    resolve_backbone  -> resolved/backbone.fasta, provenance/backbone.fasta.json

  A local file is copied into the run directory. An NCBI accession is
  downloaded with the NCBI Datasets CLI into a cache shared by all runs
  (<output_root>/ncbi-accessions-cache/) and copied from there. Whether an
  existing cache entry is reused (only after its checksum matches) or
  downloaded again was decided in GenoPilot and saved as `ncbi_cache_mode`
  in config.yaml; the rule never asks.

Maintainer notes
  Uses the same shared script as annotation-transfer's resolve_inputs.smk.
  Requires `SHARED_SCRIPTS_DIR_SH` and `SHARED_ENVS_DIR` from the including
  Snakefile. The params functions take only
  `wildcards` and repeat this rule's paths as literals, so a
  configuration-only change such as switching the cache mode is recorded in
  Snakemake's job metadata and triggers a rerun.
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
        str(SHARED_ENVS_DIR / "ncbi-datasets-cli" / "environment.yaml")
    shell:
        "python3 {SHARED_SCRIPTS_DIR_SH}/resolve_input.py {params.args} > {log} 2>&1"
