#!/usr/bin/env python3
"""Write the provenance of one cohort iteration of a saved decision.

Runs last in an iteration, after its consensus is generated, and writes
provenance/cohort/iteration-<n>.json:

  decision           the saved decision file with its checksum and content
  voting_isolates    the isolates that voted, with the checksums of the
                     variants and callable mask they voted with
  excluded_isolates  every other selected isolate and whether its processing
                     is `completed` or `incomplete` (failed or interrupted:
                     it has no promotion candidate); its logs and partial
                     results stay where they are
  initial_cohort     whether the initial all-selected cohort was aggregated
  artifacts          every output and log of the iteration, checksummed
  tool_versions      the pinned versions and those the cohort steps' shared
                     environment reported, from the first voter's provenance
  commands           the iteration's jobs from the run's `events.jsonl`

The run-level artifacts.yaml and provenance/run.json stay the record of the
initial run; this file never changes them.

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

WORKFLOW_SCRIPTS = Path(__file__).resolve().parent
SHARED_SCRIPTS = WORKFLOW_SCRIPTS.parents[1] / "shared" / "scripts"
sys.path.insert(0, str(WORKFLOW_SCRIPTS))
sys.path.insert(0, str(SHARED_SCRIPTS))

from artifacts import checksum_artifact, cohort_artifacts  # noqa: E402
from collect_consensus_provenance import EVENTS_FILE, configured_versions, job_commands  # noqa: E402
from provenance import read_json, sha256_file, utc_now_iso, write_json  # noqa: E402

SCHEMA_VERSION = 1

VOTER_INPUTS = (
    ("variants", "variants.vcf.gz", "vcf"),
    ("variants-index", "variants.vcf.gz.csi", "index"),
    ("callable-mask", "callable-mask.bed", "bed"),
)


def processing_state(isolate_id: str) -> str:
    """`completed` when the isolate's last per-isolate step wrote its promotion candidate."""
    candidate = Path("results/isolates") / isolate_id / "promotion-candidate.json"
    return "completed" if candidate.is_file() else "incomplete"


def iteration_commands(cohort: str) -> dict:
    """The recorded commands of the jobs that wrote this iteration's results."""
    commands = job_commands(EVENTS_FILE)
    if "jobs" not in commands:
        return commands
    prefix = f"results/cohort/{cohort}/"
    jobs = [job for job in commands["jobs"] if any(str(path).startswith(prefix) for path in job.get("outputs") or [])]
    return {**commands, "jobs": jobs}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--cohort", required=True, help="the iteration, iteration-<n>")
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--manifest-schema-version", type=int, required=True)
    parser.add_argument("--snakemake-version", required=True)
    parser.add_argument("--snakemake-python-version", required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    config = json.loads(args.config_json)
    # The voters and settings as this iteration's consensus step applied them, which keeps the
    # script on the standard library: the decision itself is YAML, recorded by its checksum.
    consensus = read_json(Path("results/cohort") / args.cohort / "consensus-summary.json")
    voters = consensus["voters"]
    backbone = read_json(Path("provenance/backbone.fasta.json"))
    # The cohort steps run in the environment the isolates were processed in, whose tools each
    # isolate's provenance observed; the initial run's provenance reads them the same way.
    observed = read_json(Path("results/isolates") / voters[0] / "provenance.json")["tool_versions"]

    write_json(args.provenance, {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "workflow": {
            "id": config["workflow_id"],
            "version": config["workflow_version"],
            "manifest_schema_version": args.manifest_schema_version,
            "manifest_checksum": {"algorithm": "sha256", "value": sha256_file(args.manifest)},
        },
        # The GenoPilot that saved the configuration, so the run can be traced to a release.
        "genopilot": config["genopilot"],
        "run": config["run"],
        "cohort": args.cohort,
        "decision": {
            "path": args.decision.as_posix(),
            "checksum": {"algorithm": "sha256", "value": sha256_file(args.decision)},
        },
        "consensus": {
            key: consensus[key]
            for key in ("include_backbone_vote", "voting_method", "min_callable_isolates", "unresolved_snp")
        },
        "voting_isolates": {
            isolate_id: {
                "inputs": [
                    checksum_artifact({
                        "id": artifact_id,
                        "path": f"results/isolates/{isolate_id}/{name}",
                        "type": artifact_type,
                        "stage": "process-isolates",
                        "isolate": isolate_id,
                    })
                    for artifact_id, name, artifact_type in VOTER_INPUTS
                ],
                "provenance": f"results/isolates/{isolate_id}/provenance.json",
            }
            for isolate_id in voters
        },
        "excluded_isolates": {
            isolate_id: {"processing": processing_state(isolate_id)}
            for isolate_id in config["inputs"]["selected_isolates"]
            if isolate_id not in voters
        },
        "initial_cohort": {
            "aggregated": Path("results/cohort/initial/support-summary.json").is_file(),
        },
        "backbone": checksum_artifact(
            {"id": "resolved-backbone", "path": "resolved/backbone.fasta", "type": "fasta", "stage": "resolve-inputs"},
            backbone["origin"],
        ),
        "artifacts": [checksum_artifact(entry) for entry in cohort_artifacts(args.cohort)],
        "tool_versions": {
            "configured": configured_versions(),
            "observed": {
                **observed,
                "snakemake": {"version": args.snakemake_version, "source": "workflow-runtime"},
                "snakemake-python": {"version": args.snakemake_python_version, "source": "workflow-runtime"},
            },
        },
        "commands": iteration_commands(args.cohort),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
