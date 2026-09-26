"""Trim, align, and merge every isolate's reads against the backbone.

What it does
  index_backbone       bwa and samtools indexes of the resolved backbone
                       -> resolved/backbone.fasta.{amb,ann,bwt,pac,sa,fai}
  trim_read_pair       fastp: read QC and light adapter trimming, per read pair
                       -> results/isolates/{isolate}/pairs/{pair}/fastp.json, fastp.html
  align_read_pair      bwa mem with the pair's read group, then fixmate and sort
  mark_duplicates      merges the isolate's pairs and marks duplicates per library
                       -> results/isolates/{isolate}/alignment.bam(.bai), markdup.json
  alignment_metrics    samtools stats, flagstat, and per-contig coverage
                       -> results/isolates/{isolate}/samtools-stats.txt, flagstat.json,
                          coverage.tsv

  Trimmed reads and per-pair alignments are temporary: the isolate's BAM
  keeps every read, and fastp's reports keep what trimming did.

  Every option that changes a result is written out below rather than left
  to a tool default:
    fastp    adapters detected for paired-end reads; quality filtering off,
             because the aligner soft-clips and the caller weighs base
             qualities; reads shorter than 30 bp dropped; poly-G tails of at
             least 10 bases trimmed on every instrument, not only on the
             two-colour ones fastp recognizes by name
    bwa mem  a fixed batch size (-K), so alignments do not depend on the
             number of threads

Maintainer notes
  Requires `SCRIPTS_DIR_SH`, `ENVS_DIR`, `read_pair_of`, and
  `pair_numbers` from the including Snakefile. The params functions take
  only `wildcards` and repeat this file's paths as literals, so a
  configuration-only change is recorded in Snakemake's job metadata.
"""

import shlex

BACKBONE_INDEX = multiext("resolved/backbone.fasta", ".amb", ".ann", ".bwt", ".pac", ".sa", ".fai")
FASTP_OPTIONS = (
    "--detect_adapter_for_pe --disable_quality_filtering --length_required 30"
    " --trim_poly_g --poly_g_min_len 10"
)
BWA_BATCH_BASES = 100000000


def _pair_dir(wildcards):
    return f"results/isolates/{wildcards.isolate}/pairs/{wildcards.pair}"


def _pair_reads(wildcards):
    pair = read_pair_of(wildcards)
    return {"r1": pair["r1"], "r2": pair["r2"]}


def _trim_args(wildcards):
    pair = read_pair_of(wildcards)
    directory = _pair_dir(wildcards)
    args = [
        "--in1", pair["r1"],
        "--in2", pair["r2"],
        "--out1", f"{directory}/trimmed_R1.fastq.gz",
        "--out2", f"{directory}/trimmed_R2.fastq.gz",
        "--json", f"{directory}/fastp.json",
        "--html", f"{directory}/fastp.html",
        "--report_title", f"{wildcards.isolate} read pair {wildcards.pair}",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


def _isolate_pair_files(pattern):
    def files(wildcards):
        return [
            pattern.format(isolate=wildcards.isolate, pair=number)
            for number in pair_numbers(wildcards.isolate)
        ]

    return files


def _mark_duplicates_args(wildcards):
    directory = f"results/isolates/{wildcards.isolate}"
    args = []
    for number in pair_numbers(wildcards.isolate):
        args += [
            "--pair",
            f"{directory}/pairs/{number}/aligned.bam",
            f"{directory}/pairs/{number}/read-validation.json",
        ]
    args += [
        "--output", f"{directory}/alignment.bam",
        "--metrics", f"{directory}/markdup.json",
        "--work-dir", f"{directory}/markdup-work",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


def _coverage_filters(wildcards):
    calling = config["calling"]
    return f"--min-MQ {int(calling['min_mapping_quality'])} --min-BQ {int(calling['min_base_quality'])}"


rule index_backbone:
    input:
        fasta="resolved/backbone.fasta",
        run_inputs="results/input-validation.json",
    output:
        BACKBONE_INDEX,
    log:
        "logs/index-backbone.log",
    benchmark:
        "logs/index-backbone.benchmark.tsv"
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(bwa index resolved/backbone.fasta && samtools faidx resolved/backbone.fasta) > {log} 2>&1"


rule trim_read_pair:
    input:
        unpack(_pair_reads),
        report="results/isolates/{isolate}/pairs/{pair}/read-validation.json",
    output:
        r1=temp("results/isolates/{isolate}/pairs/{pair}/trimmed_R1.fastq.gz"),
        r2=temp("results/isolates/{isolate}/pairs/{pair}/trimmed_R2.fastq.gz"),
        json="results/isolates/{isolate}/pairs/{pair}/fastp.json",
        html="results/isolates/{isolate}/pairs/{pair}/fastp.html",
    log:
        "logs/isolates/{isolate}/pairs/{pair}/trim-read-pair.log",
    benchmark:
        "logs/isolates/{isolate}/pairs/{pair}/trim-read-pair.benchmark.tsv"
    threads: 4
    params:
        args=_trim_args,
        options=FASTP_OPTIONS,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "fastp {params.args} {params.options} --thread {threads} > {log} 2>&1"


rule align_read_pair:
    input:
        r1="results/isolates/{isolate}/pairs/{pair}/trimmed_R1.fastq.gz",
        r2="results/isolates/{isolate}/pairs/{pair}/trimmed_R2.fastq.gz",
        read_group="results/isolates/{isolate}/pairs/{pair}/read-group.txt",
        index=BACKBONE_INDEX,
    output:
        temp("results/isolates/{isolate}/pairs/{pair}/aligned.bam"),
    log:
        "logs/isolates/{isolate}/pairs/{pair}/align-read-pair.log",
    benchmark:
        "logs/isolates/{isolate}/pairs/{pair}/align-read-pair.benchmark.tsv"
    threads: 8
    params:
        batch_bases=BWA_BATCH_BASES,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(bwa mem -t {threads} -K {params.batch_bases} -v 1 -R \"$(cat {input.read_group})\""
        " resolved/backbone.fasta {input.r1} {input.r2}"
        " | samtools fixmate -m -u - -"
        " | samtools sort -@ {threads} -o {output} -) > {log} 2>&1"


rule mark_duplicates:
    input:
        bams=_isolate_pair_files("results/isolates/{isolate}/pairs/{pair}/aligned.bam"),
        reports=_isolate_pair_files("results/isolates/{isolate}/pairs/{pair}/read-validation.json"),
    output:
        bam="results/isolates/{isolate}/alignment.bam",
        bai="results/isolates/{isolate}/alignment.bam.bai",
        metrics="results/isolates/{isolate}/markdup.json",
    log:
        "logs/isolates/{isolate}/mark-duplicates.log",
    benchmark:
        "logs/isolates/{isolate}/mark-duplicates.benchmark.tsv"
    threads: 4
    params:
        args=_mark_duplicates_args,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "python3 {SCRIPTS_DIR_SH}/samtools_markdup_per_library.py {params.args} --threads {threads} > {log} 2>&1"


rule alignment_metrics:
    input:
        bam="results/isolates/{isolate}/alignment.bam",
        bai="results/isolates/{isolate}/alignment.bam.bai",
        index=BACKBONE_INDEX,
    output:
        stats="results/isolates/{isolate}/samtools-stats.txt",
        flagstat="results/isolates/{isolate}/flagstat.json",
        coverage="results/isolates/{isolate}/coverage.tsv",
    log:
        "logs/isolates/{isolate}/alignment-metrics.log",
    benchmark:
        "logs/isolates/{isolate}/alignment-metrics.benchmark.tsv"
    params:
        coverage_filters=_coverage_filters,
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(samtools stats --reference resolved/backbone.fasta {input.bam} > {output.stats}"
        " && samtools flagstat -O json {input.bam} > {output.flagstat}"
        " && samtools coverage {params.coverage_filters} -o {output.coverage} {input.bam}) 2> {log}"
