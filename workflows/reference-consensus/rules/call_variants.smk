"""Call every isolate haploid against the backbone and decide which positions are callable.

What it does
  call_all_sites             bcftools mpileup | call --ploidy 1 at every covered position
                             -> results/isolates/{isolate}/all-sites.bcf(.csi)
  classify_callability       callable / ambiguous / uncallable for every backbone base
                             -> results/isolates/{isolate}/callable-mask.bed,
                                consensus-mask.bed, callability.json
  filter_normalize_variants  the called variants, filtered and left-aligned
                             -> results/isolates/{isolate}/variants.vcf.gz(.csi)

  The run's calling thresholds map onto the tools as follows:
    min_mapping_quality  mpileup --min-MQ: reads below it are not counted
    min_base_quality     mpileup --min-BQ: bases below it are not counted
    min_depth            the sum of FORMAT/AD, i.e. the reads that remain after
                         those filters and without duplicates
    min_allele_fraction  the winning allele's share of that depth

  Every other result-changing mpileup option is written out below: the
  maximum depth, the read flags that are skipped (duplicates among them), and
  the indel-candidate thresholds. Base-alignment quality stays at the pinned
  bcftools' default (applied only in problematic regions); the recorded
  command and version document it.

  The all-sites BCF is kept as the evidence behind every mask decision. The
  normalized VCF holds the called variants only, each with `PASS` or a named
  filter (`LowDepth`, `LowAlleleFraction`), and the consensus applies only
  `PASS` records. The filters and the mask use the same depth and fraction,
  so a `PASS` variant always lies on callable bases.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `ENVS_DIR` from the including Snakefile. The
  params functions take only `wildcards`, so a threshold change is recorded
  in Snakemake's job metadata and reruns calling without realigning.
"""

MPILEUP_OPTIONS = (
    "--max-depth 10000 --skip-any-set UNMAP,SECONDARY,QCFAIL,DUP"
    " --min-ireads 2 --gap-frac 0.05 --annotate FORMAT/AD,FORMAT/DP"
)


def _calling():
    return config["calling"]


def _mpileup_thresholds(wildcards):
    calling = _calling()
    return f"--min-MQ {int(calling['min_mapping_quality'])} --min-BQ {int(calling['min_base_quality'])}"


def _classification_thresholds(wildcards):
    calling = _calling()
    return (
        f"--min-depth {int(calling['min_depth'])}"
        f" --min-allele-fraction {float(calling['min_allele_fraction'])}"
    )


def _variant_filters(wildcards):
    calling = _calling()
    depth = int(calling["min_depth"])
    fraction = float(calling["min_allele_fraction"])
    return (
        f"bcftools filter --soft-filter LowDepth --exclude 'SUM(FMT/AD)<{depth}' -Ou"
        f" | bcftools filter --mode + --soft-filter LowAlleleFraction"
        f" --exclude 'MAX(FMT/AD[0:1-])/SUM(FMT/AD)<{fraction}' -Ou"
    )


rule call_all_sites:
    input:
        bam="results/isolates/{isolate}/alignment.bam",
        bai="results/isolates/{isolate}/alignment.bam.bai",
        index=BACKBONE_INDEX,
    output:
        bcf="results/isolates/{isolate}/all-sites.bcf",
        csi="results/isolates/{isolate}/all-sites.bcf.csi",
    log:
        "logs/isolates/{isolate}/call-all-sites.log",
    benchmark:
        "logs/isolates/{isolate}/call-all-sites.benchmark.tsv"
    threads: 2
    params:
        thresholds=_mpileup_thresholds,
        options=MPILEUP_OPTIONS,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(bcftools mpileup --fasta-ref resolved/backbone.fasta {params.thresholds} {params.options}"
        " -Ou {input.bam}"
        " | bcftools call --multiallelic-caller --ploidy 1 --threads {threads} -Ob -o {output.bcf}"
        " && bcftools index {output.bcf}) > {log} 2>&1"


rule classify_callability:
    input:
        bcf="results/isolates/{isolate}/all-sites.bcf",
        csi="results/isolates/{isolate}/all-sites.bcf.csi",
        fai="resolved/backbone.fasta.fai",
    output:
        mask="results/isolates/{isolate}/callable-mask.bed",
        consensus_mask="results/isolates/{isolate}/consensus-mask.bed",
        summary="results/isolates/{isolate}/callability.json",
    log:
        "logs/isolates/{isolate}/classify-callability.log",
    benchmark:
        "logs/isolates/{isolate}/classify-callability.benchmark.tsv"
    params:
        thresholds=_classification_thresholds,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(bcftools query --format '%CHROM\\t%POS\\t%REF\\t%ALT\\t[%AD]\\n' {input.bcf}"
        " | python3 {SCRIPTS_DIR_SH}/classify_callability.py --fai {input.fai} {params.thresholds}"
        " --mask {output.mask} --consensus-mask {output.consensus_mask} --summary {output.summary})"
        " > {log} 2>&1"


rule filter_normalize_variants:
    input:
        bcf="results/isolates/{isolate}/all-sites.bcf",
        csi="results/isolates/{isolate}/all-sites.bcf.csi",
        fai="resolved/backbone.fasta.fai",
    output:
        vcf="results/isolates/{isolate}/variants.vcf.gz",
        csi="results/isolates/{isolate}/variants.vcf.gz.csi",
    log:
        "logs/isolates/{isolate}/filter-normalize-variants.log",
    benchmark:
        "logs/isolates/{isolate}/filter-normalize-variants.benchmark.tsv"
    params:
        filters=_variant_filters,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        # Filters run before multiallelic records are split, so an allele's share counts
        # every read at the position; the split then keeps only the called allele.
        "(bcftools view --include 'GT=\"alt\"' -Ou {input.bcf}"
        " | {params.filters}"
        " | bcftools norm --fasta-ref resolved/backbone.fasta --check-ref e --multiallelics -any -Ou"
        " | bcftools view --include 'GT=\"alt\"' -Oz -o {output.vcf}"
        " && bcftools index {output.vcf}"
        " && bcftools view --header-only {output.vcf} > /dev/null) > {log} 2>&1"
