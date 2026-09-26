"""Optionally prefix the IDs of the transferred annotation.

What it does
  When config.yaml sets `annotation.id_prefix`, every `ID`, `Parent`, and
  `Derives_from` value in LiftOn's GFF3 gets that prefix, so the target
  annotation's IDs are told apart from the reference's. Nothing else
  changes: names, descriptions, and database references stay
  byte-identical.

  Reads:  results/annotation/lifton.raw.gff3
  Writes: results/annotation/lifton.prefixed.gff3 (a new file; LiftOn's output is never modified)

  Without a prefix this step does not exist: no "prefixed" copy is written,
  and later steps use LiftOn's raw GFF3. `ANNOTATION_GFF3`, defined below,
  names whichever file later steps use.

  Changing only the prefix reruns this step and the ones after it, but not
  LiftOn.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` from the including Snakefile. The params
  function takes only `wildcards` and repeats this rule's paths as
  literals: Snakemake does not record a params function that takes `input`
  or `output` in its job metadata (confirmed against the pinned release),
  so a prefix-only change would silently not trigger the rerun this rule
  exists to guarantee.
"""

import shlex

ANNOTATION_GFF3 = (
    "results/annotation/lifton.prefixed.gff3"
    if config["annotation"]["id_prefix"]
    else "results/annotation/lifton.raw.gff3"
)

if config["annotation"]["id_prefix"]:

    def _prefix_annotation_args(wildcards):
        args = [
            "--source",
            "results/annotation/lifton.raw.gff3",
            "--destination",
            "results/annotation/lifton.prefixed.gff3",
            "--prefix",
            config["annotation"]["id_prefix"],
        ]
        return " ".join(shlex.quote(str(arg)) for arg in args)

    rule prefix_annotation:
        input:
            raw_gff3="results/annotation/lifton.raw.gff3",
        output:
            gff3="results/annotation/lifton.prefixed.gff3",
        log:
            "logs/prefix-annotation.log",
        params:
            args=_prefix_annotation_args,
        shell:
            "python3 {SCRIPTS_DIR_SH}/prefix_gff3.py {params.args} > {log} 2>&1"
