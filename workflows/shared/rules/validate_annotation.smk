"""Check the structure of the final transferred annotation.

What it does
  Runs the same GFF3 checks as input validation (columns, coordinates,
  strands, CDS phase, IDs, and Parent relationships) on the annotation later
  steps use: the prefixed GFF3 when an ID prefix is configured, otherwise
  LiftOn's raw GFF3.

  Reads:  ANNOTATION_GFF3 (defined in prefix_annotation.smk)
  Writes: results/validation.json (status "passed" or "failed", and every problem found)

  The job succeeds even when validation fails, so the report is kept as
  evidence.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `ANNOTATION_GFF3` from the including
  Snakefile.
"""

rule validate_annotation:
    input:
        gff3=ANNOTATION_GFF3,
    output:
        "results/validation.json",
    log:
        "logs/validate-annotation.log",
    shell:
        "python3 {SCRIPTS_DIR_SH}/validate_annotation.py"
        " --gff3 {input.gff3}"
        " --output results/validation.json"
        " > {log} 2>&1"
