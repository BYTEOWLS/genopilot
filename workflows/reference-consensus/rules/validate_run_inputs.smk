"""Check a consensus run's inputs before any isolate is processed.

What it does
  Checks that the backbone FASTA is well formed and that every read file of
  every selected isolate exists, is readable, and is not empty. The content
  of the FASTQ files is checked later, during per-isolate processing.

  Reads:  resolved/backbone.fasta, every R1/R2 file listed in isolates.yaml
  Writes: results/input-validation.json

  Every read file is a declared input, so Snakemake itself refuses to
  schedule the run while one is missing. Unlike annotation-transfer input
  validation, a failed validation fails this job, and the report is printed
  into its log as evidence.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `ISOLATES` (the snapshot's isolates) from the
  including Snakefile. GenoPilot refuses read paths containing braces before
  it saves the snapshot, because Snakemake cannot declare them as inputs.
  The params function takes only `wildcards`; the snapshot never changes
  for a run, so its arguments change only when the snapshot does.
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
        "{PYTHON_SH} {SCRIPTS_DIR_SH}/validate_run_inputs.py"
        " --backbone-fasta resolved/backbone.fasta"
        " {params.read_pairs}"
        " --output results/input-validation.json"
        " > {log} 2>&1"
