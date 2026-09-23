"""Run LiftOn to transfer the reference annotation onto the target genome.

Runs only after `validate_inputs` has passed, so an unusable FASTA or GFF3 is
reported before LiftOn spends minutes on it.

LiftOn (target, reference positional order) combines Liftoff DNA alignment
with miniprot protein alignment; both are pinned together in
`envs/lifton/environment.yaml` since LiftOn drives them directly rather than being
invoked as separate rules. Only the same-species defaults are used here —
no advanced LiftOn tuning is exposed (see later.md "Advanced LiftOn
controls"). `-o` also determines where LiftOn creates its `lifton_output/`
diagnostics directory, which holds the intermediate `liftoff/` and
`miniprot/` subdirectories since LiftOn 1.0.12. Requires `SCRIPTS_DIR_SH` to
be defined by the including Snakefile.

Every argument below is a fixed literal path already declared in
`input:`/`output:`, so no `params:` function is needed.
"""

rule transfer_annotation:
    input:
        target="resolved/target.fasta",
        reference="resolved/reference.fasta",
        reference_annotation="resolved/reference.gff3",
        # Depending on the validation report, not only on the resolved files, is what makes
        # validation a gate rather than a sibling branch: without it Snakemake is free to
        # schedule LiftOn and validate_inputs at the same time, and given enough cores it does.
        validation="results/input-validation.json",
    output:
        gff3="results/annotation/lifton.raw.gff3",
        diagnostics=directory("results/annotation/lifton_output"),
    log:
        "logs/transfer-annotation.log",
    benchmark:
        "logs/transfer-annotation.benchmark.tsv"
    threads: config["resources"]["effective_cpus"]
    conda:
        str(ENVS_DIR / "lifton" / "environment.yaml")
    shell:
        "rm -rf results/annotation/lifton_output &&"
        " lifton resolved/target.fasta resolved/reference.fasta"
        " -g resolved/reference.gff3"
        " -o results/annotation/lifton.raw.gff3"
        " -t {threads}"
        " > {log} 2>&1"
