"""Apply the configured identifier prefix to the raw LiftOn GFF3.

A pure deterministic post-processing step, not a LiftOn feature. Depends
only on the raw GFF3 and the configured prefix, so changing only
`annotation.id_prefix` reruns this rule and `validate_annotation` without
rerunning `transfer_annotation` (Snakemake's default rerun-triggers include
`params`). Requires `SCRIPTS_DIR_SH` to be
defined by the including Snakefile.

`annotation.id_prefix` is optional. An empty prefix has nothing to rewrite,
so this rule is not defined at all and no prefixed GFF3 is written; a copy
of the raw annotation under a name promising a prefix would be misleading
evidence. `ANNOTATION_GFF3`, defined here and consumed by every rule
downstream, then names the raw LiftOn GFF3 instead.

The params function takes only `wildcards` and references this rule's own
input/output paths as literals, rather than Snakemake's `input`/`output`
objects: a params function with an `input`/`output` parameter is not
recorded in Snakemake's per-job metadata (confirmed against the pinned
Snakemake release), so a prefix-only config change would silently fail to
trigger a rerun — exactly the behavior this rule exists to guarantee.
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
