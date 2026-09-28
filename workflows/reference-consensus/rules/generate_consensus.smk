"""Choose the cohort allele at every backbone position and write the cohort consensus.

What it does
  generate_consensus  the support tables interpreted with the configured voting
                      method, minimum of callable isolates, and representation
                      of unresolved SNPs
                      -> results/cohort/initial/consensus.fasta(.fai),
                         consensus-sites.tsv.gz(.tbi), consensus-summary.json

  Only the support outputs and the backbone are read (see
  scripts/generate_consensus.py), so changing one of the three consensus
  settings reruns this rule alone and reuses the support tables. The sites
  table is bgzip-compressed and indexed with tabix like the support tables.

  The FASTA is checked with the tools' own means before anything depends on
  it: `samtools faidx` refuses a malformed FASTA, its index must list the
  backbone's sequences in the backbone's order, and a line with any other
  character than A, C, G, T, N, or an IUPAC code fails the job. The rule runs
  in a shadow directory, so a failed step leaves no partial output behind;
  its log is kept.

Maintainer notes
  Requires `SCRIPTS_DIR_SH` and `ENVS_DIR` from the including Snakefile. The
  params function takes only `wildcards`.
"""

import shlex


def _consensus_args(wildcards):
    consensus = config["consensus"]
    args = [
        "--voting-method", consensus["voting_method"],
        "--min-callable-isolates", consensus["min_callable_isolates"],
        "--unresolved-snp", consensus["unresolved_snp"],
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule generate_consensus:
    input:
        sites="results/cohort/initial/support-sites.tsv.gz",
        intervals="results/cohort/initial/support-intervals.tsv.gz",
        support_summary="results/cohort/initial/support-summary.json",
        backbone="resolved/backbone.fasta",
        fai="resolved/backbone.fasta.fai",
    output:
        fasta="results/cohort/initial/consensus.fasta",
        fai="results/cohort/initial/consensus.fasta.fai",
        sites="results/cohort/initial/consensus-sites.tsv.gz",
        sites_index="results/cohort/initial/consensus-sites.tsv.gz.tbi",
        summary="results/cohort/initial/consensus-summary.json",
    log:
        "logs/cohort/initial/generate-consensus.log",
    benchmark:
        "logs/cohort/initial/generate-consensus.benchmark.tsv"
    params:
        args=_consensus_args,
    shadow:
        "minimal"
    conda:
        str(ENVS_DIR / "short-read-calling" / "environment.yaml")
    shell:
        "(python3 {SCRIPTS_DIR_SH}/generate_consensus.py --fai {input.fai} --backbone {input.backbone}"
        " --sites {input.sites} --intervals {input.intervals} --support-summary {input.support_summary}"
        " {params.args} --fasta {output.fasta} --consensus-sites results/cohort/initial/consensus-sites.tsv"
        " --summary {output.summary}"
        " && bgzip --force results/cohort/initial/consensus-sites.tsv"
        " && tabix --force --sequence 1 --begin 2 --end 3 {output.sites}"
        " && samtools faidx {output.fasta}"
        " && cmp <(cut -f1 {input.fai}) <(cut -f1 {output.fai})"
        " && if grep -n -m 1 -v -e '^>' -e '^[ACGTRYSWKMBDHVN]*$' {output.fasta}; then"
        " echo 'the consensus holds a character other than A, C, G, T, N, or an IUPAC code' >&2; exit 1; fi"
        ") > {log} 2>&1"
