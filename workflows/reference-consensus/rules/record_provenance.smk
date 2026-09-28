"""Record the run's provenance: what was produced, from what, and with which tools.

What it does
  Runs last, so a finished run describes itself without GenoPilot:

  Writes: artifacts.yaml      - every artifact of the run with its SHA-256 checksum, stage,
                                and whether it was generated or imported
          provenance/run.json - the effective configuration, workflow and manifest versions
                                (with the manifest's checksum), the isolate snapshot's
                                checksum, the backbone and read-file origins, pinned and
                                observed tool versions, the Snakemake version, and the
                                command of every job

  With one isolate failed, this step does not run; every successful
  isolate keeps its own provenance.json.

  record_iteration_provenance runs last in an iteration of a saved decision
  instead, and never touches the two files above:

  Writes: provenance/cohort/iteration-<n>.json - the decision's checksum, the
                                voters with the checksums of what they voted
                                with, every excluded isolate as `completed`
                                or `incomplete`, whether the initial cohort
                                was aggregated, the iteration's checksummed
                                outputs, and its commands

  It depends only on the iteration's outputs and its decision, so an
  excluded, failed isolate does not stop it.

Maintainer notes
  Requires `SCRIPTS_DIR_SH`, `WORKFLOW_DIR`, `ISOLATES`, and `DECLARED_ARTIFACTS`
  from the including Snakefile. Depending on every declared artifact keeps
  this rule last in the DAG. The params functions take only `wildcards`.
"""

import importlib.metadata
import json
import shlex


def _record_consensus_provenance_args(wildcards):
    args = [
        "--config-json", json.dumps(config, sort_keys=True, separators=(",", ":")),
        # One short argument pair per isolate: the whole snapshot as one argument would exceed
        # Linux's per-argument limit (128 KiB) for a few hundred isolates.
        *[
            value
            for isolate in ISOLATES
            for value in ("--isolate", isolate["id"], len(isolate["read_pairs"]))
        ],
        "--isolates-file", config["inputs"]["isolates_file"],
        "--manifest", str(WORKFLOW_DIR / "manifest.yaml"),
        "--manifest-schema-version", 1,
        "--snakemake-version", importlib.metadata.version("snakemake"),
        "--artifacts", "artifacts.yaml",
        "--provenance", "provenance/run.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule record_consensus_provenance:
    input:
        DECLARED_ARTIFACTS,
        manifest=str(WORKFLOW_DIR / "manifest.yaml"),
    output:
        artifacts="artifacts.yaml",
        provenance="provenance/run.json",
    log:
        "logs/record-provenance.log",
    params:
        args=_record_consensus_provenance_args,
    shell:
        "python3 {SCRIPTS_DIR_SH}/collect_consensus_provenance.py {params.args} > {log} 2>&1"


def _record_iteration_provenance_args(wildcards):
    args = [
        "--config-json", json.dumps(config, sort_keys=True, separators=(",", ":")),
        "--cohort", wildcards.cohort,
        "--decision", f"decisions/{wildcards.cohort}.yaml",
        "--manifest", str(WORKFLOW_DIR / "manifest.yaml"),
        "--manifest-schema-version", 1,
        "--snakemake-version", importlib.metadata.version("snakemake"),
        "--provenance", f"provenance/cohort/{wildcards.cohort}.json",
    ]
    return " ".join(shlex.quote(str(arg)) for arg in args)


rule record_iteration_provenance:
    input:
        "results/cohort/{cohort}/consensus-summary.json",
        "results/cohort/{cohort}/consensus.fasta.fai",
        "results/cohort/{cohort}/consensus-sites.tsv.gz.tbi",
        "results/cohort/{cohort}/support-sites.tsv.gz.tbi",
        "results/cohort/{cohort}/support-intervals.tsv.gz.tbi",
        decision="decisions/{cohort}.yaml",
        manifest=str(WORKFLOW_DIR / "manifest.yaml"),
    output:
        "provenance/cohort/{cohort}.json",
    log:
        "logs/cohort/{cohort}/record-provenance.log",
    wildcard_constraints:
        cohort="iteration-(?:[2-9]|[1-9][0-9]+)",
    params:
        args=_record_iteration_provenance_args,
    shell:
        "python3 {SCRIPTS_DIR_SH}/collect_iteration_provenance.py {params.args} > {log} 2>&1"
