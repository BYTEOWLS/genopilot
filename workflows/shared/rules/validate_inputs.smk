"""Check the structure of the annotation-transfer inputs before LiftOn runs.

What it does
  Parses the reference FASTA, reference GFF3, and target FASTA and checks:
  FASTA headers and sequence characters; GFF3 columns, coordinates,
  strands, IDs, and Parent relationships; and that every sequence the
  reference GFF3 refers to exists in the reference FASTA.

  Reads:  resolved/reference.fasta, resolved/reference.gff3, resolved/target.fasta
  Writes: results/input-validation.json (status "passed" or "failed", and every problem found)

  The job succeeds even when validation fails: the outcome is recorded in
  the report, so Snakemake keeps the report as evidence instead of deleting
  the output of a failed job. transfer_annotation then refuses to start
  LiftOn unless the report passed.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` from the including Snakefile. Every argument is
  a fixed literal path, so no params function is needed; a change to one of
  these paths is a code change, which Snakemake's rerun triggers catch.
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
