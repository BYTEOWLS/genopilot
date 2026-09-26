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

Maintainer notes
  Requires `SCRIPTS_DIR_SH`, `WORKFLOW_DIR`, `ISOLATES`, and `DECLARED_ARTIFACTS`
  from the including Snakefile. Depending on every declared artifact keeps
  this rule last in the DAG.
"""

import importlib.metadata
import json
import shlex


def _record_consensus_provenance_args(wildcards):
    args = [
        "--config-json", json.dumps(config, sort_keys=True, separators=(",", ":")),
        "--isolates-json", json.dumps(ISOLATES, sort_keys=True, separators=(",", ":")),
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
