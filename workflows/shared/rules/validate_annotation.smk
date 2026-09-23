"""Validate the transferred GFF3's structure and ID/Parent relationships.

Validates `ANNOTATION_GFF3` — the prefixed GFF3 when an annotation ID
prefix is configured, the raw LiftOn GFF3 when none is — so the file this
gates is always the one downstream stages consume. Requires
`SCRIPTS_DIR_SH` and `ANNOTATION_GFF3` to be defined by the including
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
