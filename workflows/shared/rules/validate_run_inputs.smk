"""Validate a consensus run's inputs before any per-isolate processing:
the resolved backbone FASTA and every read file of the isolate snapshot.
Requires `SCRIPTS_DIR_SH` and `ISOLATES` (the snapshot's isolates) to be
defined by the including Snakefile.

Every read file is a declared input, so Snakemake itself refuses to
schedule the run when one is missing. The Snakefile has already refused
paths containing braces, which Snakemake cannot declare as inputs. The params function takes only
`wildcards`; the snapshot is immutable for a run, so its arguments change
only when the snapshot does.
"""

import shlex


def _read_files(wildcards):
    return [
        pair[mate]
        for isolate in ISOLATES
        for pair in isolate["read_pairs"]
        for mate in ("r1", "r2")
    ]


def _read_pair_args(wildcards):
    args = []
    for isolate in ISOLATES:
        for pair in isolate["read_pairs"]:
            args += [
                "--read-pair",
                isolate["id"],
                pair["r1"],
                pair["r2"],
                "trimmed" if pair["trimmed"] else "untrimmed",
            ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule validate_run_inputs:
    input:
        backbone="resolved/backbone.fasta",
        reads=_read_files,
    output:
        "results/input-validation.json",
    log:
        "logs/validate-run-inputs.log",
    params:
        read_pairs=_read_pair_args,
    shell:
        "python3 {SCRIPTS_DIR_SH}/validate_run_inputs.py"
        " --backbone-fasta resolved/backbone.fasta"
        " {params.read_pairs}"
        " --output results/input-validation.json"
        " > {log} 2>&1"
