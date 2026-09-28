"""Count the backbone's and the callable isolates' votes at every backbone position.

What it does
  aggregate_support  every selected isolate's PASS variants and callable mask,
                     plus the backbone's optional vote, as a support table
                     -> results/cohort/initial/support-sites.tsv.gz(.tbi),
                        support-intervals.tsv.gz(.tbi), support-summary.json

  The table records votes; it does not choose a winner. An isolate votes only
  where it is callable, one vote regardless of depth, and overlapping variants
  of different isolates form one locus with one vote per voter (see
  scripts/aggregate_support.py). Both tables are bgzip-compressed and indexed
  with tabix, so a region can be looked up without reading the whole table.
  The rule runs in a shadow directory, so a failed step leaves no
  uncompressed table behind; its log is kept.

  The rule depends on every selected isolate, so a failed isolate stops the
  cohort stages instead of silently leaving the vote; excluding it is a
  reviewed decision. Only the backbone vote is read from the configuration:
  changing it reruns this rule alone, and changing the voting method does not
  rerun it.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `ENVS_DIR` from the including Snakefile. The
  params functions take only `wildcards`.
"""

import shlex


def _voters():
    return config["inputs"]["selected_isolates"]


def _voter_inputs(wildcards):
    return [
        f"results/isolates/{isolate}/{name}"
        for isolate in _voters()
        for name in ("variants.vcf.gz", "variants.vcf.gz.csi", "callable-mask.bed")
    ]


def _aggregation_args(wildcards):
    args = ["--include-backbone-vote", "yes" if config["consensus"]["include_backbone_vote"] else "no"]
    for isolate in _voters():
        args += [
            "--voter", isolate,
            f"results/isolates/{isolate}/variants.vcf.gz",
            f"results/isolates/{isolate}/callable-mask.bed",
        ]
    return " ".join(shlex.quote(arg) for arg in args)


rule aggregate_support:
    input:
        _voter_inputs,
        backbone="resolved/backbone.fasta",
        fai="resolved/backbone.fasta.fai",
    output:
        sites="results/cohort/initial/support-sites.tsv.gz",
        sites_index="results/cohort/initial/support-sites.tsv.gz.tbi",
        intervals="results/cohort/initial/support-intervals.tsv.gz",
        intervals_index="results/cohort/initial/support-intervals.tsv.gz.tbi",
        summary="results/cohort/initial/support-summary.json",
    log:
        "logs/cohort/initial/aggregate-support.log",
    benchmark:
        "logs/cohort/initial/aggregate-support.benchmark.tsv"
    params:
        args=_aggregation_args,
    shadow:
        "minimal"
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(python3 {SCRIPTS_DIR_SH}/aggregate_support.py --fai {input.fai} --backbone {input.backbone}"
        " {params.args} --sites results/cohort/initial/support-sites.tsv"
        " --intervals results/cohort/initial/support-intervals.tsv --summary {output.summary}"
        " && bgzip --force results/cohort/initial/support-sites.tsv"
        " && bgzip --force results/cohort/initial/support-intervals.tsv"
        " && tabix --force --sequence 1 --begin 2 --end 3 {output.sites}"
        " && tabix --force --sequence 1 --begin 2 --end 3 {output.intervals}) > {log} 2>&1"
