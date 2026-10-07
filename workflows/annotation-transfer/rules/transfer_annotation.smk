"""Transfer the reference annotation onto the target genome with LiftOn.

What it does
  LiftOn maps every gene model of the reference GFF3 onto the target genome.
  It combines two aligners: Liftoff aligns each feature's DNA sequence and
  miniprot aligns its protein, and LiftOn builds each transferred gene model
  from both. Only LiftOn's defaults for genomes of the same species are
  used; no tuning options are exposed (see later.md, "Advanced LiftOn
  controls").

  Reads:  resolved/target.fasta, resolved/reference.fasta, resolved/reference.gff3,
          results/input-validation.json
  Writes: results/annotation/lifton.raw.gff3 - the transferred annotation, kept unmodified
          results/annotation/lifton_output/  - LiftOn's diagnostics and its Liftoff and
                                               miniprot intermediates, kept as evidence
          logs/transfer-annotation.benchmark.tsv - runtime and memory use

  LiftOn only starts when results/input-validation.json has status
  "passed". Otherwise this step fails before LiftOn runs, the log names the
  report, and the report stays in place with every problem it found.

  LiftOn, Liftoff's minimap2, miniprot, and parasail are pinned together in
  envs/lifton/environment.yaml, because LiftOn drives them itself rather
  than as separate rules. Snakemake installs that environment (--use-conda).

Maintainer notes
  LiftOn takes the target before the reference. `-o` also decides where
  LiftOn creates its `lifton_output/` directory, which holds the `liftoff/`
  and `miniprot/` intermediates since LiftOn 1.0.12. Requires
  `SCRIPTS_DIR_SH` and `ENVS_DIR` from the including Snakefile. Every
  argument is a fixed literal path, so no params function is needed.
"""

rule transfer_annotation:
    input:
        target="resolved/target.fasta",
        reference="resolved/reference.fasta",
        reference_annotation="resolved/reference.gff3",
        # Depending on the validation report, not only on the resolved files, makes this step
        # wait for validation: without it Snakemake is free to schedule LiftOn and
        # validate_inputs at the same time, and given enough cores it does. The shell command
        # below then refuses to start LiftOn unless the report passed.
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
        "python3 {SCRIPTS_DIR_SH}/require_passed_validation.py results/input-validation.json"
        " > {log} 2>&1 &&"
        " rm -rf results/annotation/lifton_output &&"
        " lifton resolved/target.fasta resolved/reference.fasta"
        " -g resolved/reference.gff3"
        " -o results/annotation/lifton.raw.gff3"
        " -t {threads}"
        " >> {log} 2>&1"
