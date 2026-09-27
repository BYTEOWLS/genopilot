"""Build every isolate's reference-guided FASTA and summarize the isolate.

What it does
  build_isolate_consensus  bcftools consensus: the backbone with the isolate's PASS
                           variants applied and every ambiguous or uncallable base
                           replaced by N
                           -> results/isolates/{isolate}/consensus.fasta(.fai),
                              consensus.chain
  summarize_isolate        metrics, provenance, and the promotion candidate
                           -> results/isolates/{isolate}/metrics.json, provenance.json,
                              promotion-candidate.json, variant-stats.txt

  The isolate FASTA holds only A, C, G, T, and N. The backbone supplies the
  coordinates and every base the isolate does not change; lowercase
  soft-masking in the backbone is annotation, not sequence, and is dropped.
  The chain file maps backbone coordinates onto the FASTA's.

  The FASTA is checked with the tools' own means before anything depends on
  it: `samtools faidx` refuses a malformed FASTA, its index must list the
  backbone's sequences in the backbone's order, and a line with any other
  base than A, C, G, T, or N fails the job. That bcftools applied the
  variants and the mask correctly is bcftools' contract and is not checked
  again here.

Maintainer notes
  Requires `SCRIPTS_DIR_SH`, `ENVS_DIR`, `ISOLATES_BY_ID`, and
  `BACKBONE_INDEX` from the including Snakefile. The params functions take
  only `wildcards`.
"""

import json
import shlex


def _summary_args(wildcards):
    directory = f"results/isolates/{wildcards.isolate}"
    args = [
        "--config-json", json.dumps(config, sort_keys=True, separators=(",", ":")),
        "--isolate-json", json.dumps(ISOLATES_BY_ID[wildcards.isolate], sort_keys=True, separators=(",", ":")),
        "--metrics", f"{directory}/metrics.json",
        "--provenance", f"{directory}/provenance.json",
        "--candidate", f"{directory}/promotion-candidate.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


def _isolate_pair_reports(wildcards):
    return [
        f"results/isolates/{wildcards.isolate}/pairs/{number}/{name}"
        for number in pair_numbers(wildcards.isolate)
        for name in ("read-validation.json", "fastp.json")
    ]


rule build_isolate_consensus:
    input:
        vcf="results/isolates/{isolate}/variants.vcf.gz",
        csi="results/isolates/{isolate}/variants.vcf.gz.csi",
        mask="results/isolates/{isolate}/consensus-mask.bed",
        index=BACKBONE_INDEX,
    output:
        fasta="results/isolates/{isolate}/consensus.fasta",
        fai="results/isolates/{isolate}/consensus.fasta.fai",
        chain="results/isolates/{isolate}/consensus.chain",
    log:
        "logs/isolates/{isolate}/build-isolate-consensus.log",
    benchmark:
        "logs/isolates/{isolate}/build-isolate-consensus.benchmark.tsv"
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(bcftools consensus --fasta-ref resolved/backbone.fasta --haplotype 1"
        " --include 'FILTER=\"PASS\"' --mask {input.mask} --mask-with N"
        " --chain {output.chain} {input.vcf}"
        " | awk '/^>/ {{ print; next }} {{ print toupper($0) }}' > {output.fasta}"
        " && samtools faidx {output.fasta}"
        " && cmp <(cut -f1 resolved/backbone.fasta.fai) <(cut -f1 {output.fai})"
        " && if grep -n -m 1 -v -e '^>' -e '^[ACGTN]*$' {output.fasta}; then"
        " echo 'the consensus holds a base other than A, C, G, T, or N' >&2; exit 1; fi"
        ") > {log} 2>&1"


rule summarize_isolate:
    input:
        reports=_isolate_pair_reports,
        fasta="results/isolates/{isolate}/consensus.fasta",
        fai="results/isolates/{isolate}/consensus.fasta.fai",
        chain="results/isolates/{isolate}/consensus.chain",
        vcf="results/isolates/{isolate}/variants.vcf.gz",
        markdup="results/isolates/{isolate}/markdup.json",
        flagstat="results/isolates/{isolate}/flagstat.json",
        coverage="results/isolates/{isolate}/coverage.tsv",
        stats="results/isolates/{isolate}/samtools-stats.txt",
        callability="results/isolates/{isolate}/callability.json",
        mask="results/isolates/{isolate}/callable-mask.bed",
        bcf="results/isolates/{isolate}/all-sites.bcf",
        bam="results/isolates/{isolate}/alignment.bam",
    output:
        metrics="results/isolates/{isolate}/metrics.json",
        provenance="results/isolates/{isolate}/provenance.json",
        candidate="results/isolates/{isolate}/promotion-candidate.json",
        variant_stats="results/isolates/{isolate}/variant-stats.txt",
    log:
        "logs/isolates/{isolate}/summarize-isolate.log",
    benchmark:
        "logs/isolates/{isolate}/summarize-isolate.benchmark.tsv"
    params:
        args=_summary_args,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(bcftools stats --apply-filters PASS {input.vcf} > {output.variant_stats}"
        " && python3 {SCRIPTS_DIR_SH}/summarize_isolate.py {params.args}) > {log} 2>&1"
