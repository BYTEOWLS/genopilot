"""Validate resolved FASTA/GFF3 inputs before any scientific rule runs.
Requires `SCRIPTS_DIR_SH` to be defined by the including Snakefile. Every
argument here is a fixed literal path already declared in `input:`/
`output:` below, so no `params:` function is needed (a change to any of
these paths is a code change Snakemake's `code` rerun-trigger already
catches).
"""

rule validate_inputs:
    input:
        reference_fasta="resolved/reference.fasta",
        reference_gff3="resolved/reference.gff3",
        target_fasta="resolved/target.fasta",
    output:
        "results/input-validation.json",
    log:
        "logs/validate-inputs.log",
    shell:
        "python3 {SCRIPTS_DIR_SH}/validate_inputs.py"
        " --reference-fasta resolved/reference.fasta"
        " --reference-gff3 resolved/reference.gff3"
        " --target-fasta resolved/target.fasta"
        " --output results/input-validation.json"
        " > {log} 2>&1"
