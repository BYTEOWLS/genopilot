"""Check the structure of the transferred annotation.

What it does
  Runs the same GFF3 checks as input validation (columns, coordinates,
  strands, CDS phase, IDs, and Parent relationships) on LiftOn's GFF3.

  Reads:  results/annotation/lifton.raw.gff3
  Writes: results/validation.json (status "passed" or "failed", and every problem found)

  The job succeeds even when validation fails, so the report is kept as
  evidence.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` from the including Snakefile.
"""

rule validate_annotation:
    input:
        gff3="results/annotation/lifton.raw.gff3",
    output:
        "results/validation.json",
    log:
        "logs/validate-annotation.log",
    shell:
        "{PYTHON_SH} {SCRIPTS_DIR_SH}/validate_annotation.py"
        " --gff3 {input.gff3}"
        " --output results/validation.json"
        " > {log} 2>&1"
