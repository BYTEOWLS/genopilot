"""Validate every read pair completely and derive its read group.

What it does
  One job per read pair of every selected isolate. Reads both FASTQ files
  in full, checks record integrity, mate names, and optional Illumina header
  evidence, and records checksums. Read groups use snapshot library identity,
  generated IDs, and optional header-derived sequencing metadata:

    validate_read_pair  -> results/isolates/{isolate}/pairs/{pair}/read-validation.json
                           results/isolates/{isolate}/pairs/{pair}/read-group.txt

  `{pair}` is the pair's 1-based position in the isolate's snapshot entry.
  A pair that fails validation fails its job; the report is printed into the
  job's log as evidence. Only a passed pair is trimmed and aligned.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `read_pair_of` from the including Snakefile.
  Runs without a conda environment: the script uses only the standard library.
  The params function takes only `wildcards` and repeats the output paths as
  literals, so a configuration-only change is recorded in Snakemake's job
  metadata.
"""

import json
import shlex


def _read_pair_files(wildcards):
    pair = read_pair_of(wildcards)
    return {"r1": pair["r1"], "r2": pair["r2"]}


def _validate_read_pair_args(wildcards):
    pair = read_pair_of(wildcards)
    directory = f"results/isolates/{wildcards.isolate}/pairs/{wildcards.pair}"
    args = [
        "--isolate-id", wildcards.isolate,
        "--pair", wildcards.pair,
        "--r1", pair["r1"],
        "--r2", pair["r2"],
        "--trimmed", "trimmed" if pair["trimmed"] else "untrimmed",
        "--library-id", pair["library_id"],
        "--read-set-id", pair["read_set_id"],
        "--read-group-id", pair["read_group_id"],
        "--preprocessing-json", json.dumps(pair["preprocessing"], sort_keys=True),
        "--report", f"{directory}/read-validation.json",
        "--read-group", f"{directory}/read-group.txt",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule validate_read_pair:
    input:
        unpack(_read_pair_files),
        run_inputs="results/input-validation.json",
    output:
        report="results/isolates/{isolate}/pairs/{pair}/read-validation.json",
        read_group="results/isolates/{isolate}/pairs/{pair}/read-group.txt",
    log:
        "logs/isolates/{isolate}/pairs/{pair}/validate-read-pair.log",
    benchmark:
        "logs/isolates/{isolate}/pairs/{pair}/validate-read-pair.benchmark.tsv"
    params:
        args=_validate_read_pair_args,
    shell:
        "{PYTHON_SH} {SCRIPTS_DIR_SH}/validate_read_pair.py {params.args} > {log} 2>&1"
