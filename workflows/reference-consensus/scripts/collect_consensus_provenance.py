#!/usr/bin/env python3
"""Write the reference-consensus artifact index and run provenance records.

Runs last, after every isolate is summarized, so a finished run describes
itself without GenoPilot:

  artifacts.yaml       every artifact of the run (see artifacts.py) with its
                       SHA-256, size, stage, and origin: the backbone is
                       `imported` from a local file or an NCBI download (as
                       its resolution recorded), everything else `generated`
  provenance/run.json  the workflow and manifest checksum, the run and its
                       effective configuration, the isolate snapshot's
                       checksum, the backbone's and every read file's origin
                       and checksums, pinned and observed tool versions, the
                       Snakemake version, and the command of every job

The commands come from the run's `events.jsonl`, which the GenoPilot run
events logger writes through Snakemake's logger interface; a run started
without that logger records them as unavailable. The per-isolate details
live in each isolate's provenance.json, which this record links.

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

WORKFLOW_SCRIPTS = Path(__file__).resolve().parent
SHARED_SCRIPTS = WORKFLOW_SCRIPTS.parents[1] / "shared" / "scripts"
sys.path.insert(0, str(WORKFLOW_SCRIPTS))
sys.path.insert(0, str(SHARED_SCRIPTS))

from artifacts import checksum_artifact, run_artifacts, sha256_file  # noqa: E402
from collect_run_provenance import canonical_json_checksum, configured_tool_versions, write_json  # noqa: E402

SCHEMA_VERSION = 1
EVENTS_FILE = Path("events.jsonl")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def job_commands(events_path: Path) -> dict:
    """Every started job's rule, wildcards, outputs, and command, across all attempts."""
    if not events_path.is_file():
        return {"status": "unavailable", "reason": "the run was started without the GenoPilot run events logger"}
    jobs = []
    for line in events_path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "job-started" and event.get("rule") != "all":
            jobs.append({
                key: event.get(key) for key in ("timestamp", "rule", "wildcards", "outputs", "command")
            })
    return {"source": events_path.as_posix(), "jobs": jobs}


def configured_versions() -> dict:
    """The exact pins of the environments this workflow's rules use."""
    workflow = configured_tool_versions(WORKFLOW_SCRIPTS.parent / "envs")
    shared = configured_tool_versions(SHARED_SCRIPTS.parent / "envs")
    return {**workflow, "ncbi-datasets-cli": shared["ncbi-datasets-cli"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config-json", required=True)
    parser.add_argument(
        "--isolate",
        nargs=2,
        action="append",
        default=[],
        metavar=("ID", "READ_PAIRS"),
        help="a selected isolate and its number of read pairs, in snapshot order",
    )
    parser.add_argument("--isolates-file", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--manifest-schema-version", type=int, required=True)
    parser.add_argument("--snakemake-version", required=True)
    parser.add_argument("--snakemake-python-version", required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    config = json.loads(args.config_json)
    isolates = [{"id": isolate_id, "read_pairs": [{}] * int(pairs)} for isolate_id, pairs in args.isolate]
    generated_at = utc_now_iso()
    backbone = read_json(Path("provenance/backbone.fasta.json"))
    workflow = {
        "id": config["workflow_id"],
        "version": config["workflow_version"],
        "manifest_schema_version": args.manifest_schema_version,
        "manifest_checksum": {"algorithm": "sha256", "value": sha256_file(args.manifest)},
    }

    artifacts = [
        checksum_artifact(entry, backbone["origin"] if entry["id"] == "resolved-backbone" else "generated")
        for entry in run_artifacts(isolates)
    ]
    # JSON is valid YAML and keeps this script on the standard library.
    write_json(args.artifacts, {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "workflow": workflow,
        "effective_configuration_checksum": canonical_json_checksum(config),
        "artifacts": artifacts,
    })

    isolate_provenance = {
        isolate["id"]: read_json(Path("results/isolates") / isolate["id"] / "provenance.json")
        for isolate in isolates
    }
    observed = next(iter(isolate_provenance.values()))["tool_versions"] if isolate_provenance else {}
    write_json(args.provenance, {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "workflow": workflow,
        # The GenoPilot that saved the configuration, so the run can be traced to a release.
        "genopilot": config["genopilot"],
        "run": config["run"],
        "effective_configuration": config,
        "resources": {
            "requested": {key: value for key, value in config["resources"].items() if key != "effective_cpus"},
            "effective_cpus": config["resources"]["effective_cpus"],
        },
        "inputs": {
            "backbone": backbone,
            "isolate_snapshot": {
                "path": args.isolates_file.as_posix(),
                "checksum": {"algorithm": "sha256", "value": sha256_file(args.isolates_file)},
            },
            "read_pairs": {
                isolate_id: record["read_pairs"] for isolate_id, record in isolate_provenance.items()
            },
        },
        "isolates": {
            isolate_id: f"results/isolates/{isolate_id}/provenance.json" for isolate_id in isolate_provenance
        },
        "tool_versions": {
            "configured": configured_versions(),
            "observed": {
                **observed,
                "snakemake": {"version": args.snakemake_version, "source": "workflow-runtime"},
                "snakemake-python": {"version": args.snakemake_python_version, "source": "workflow-runtime"},
            },
        },
        "commands": job_commands(EVENTS_FILE),
        "artifact_index": {
            "path": args.artifacts.as_posix(),
            "checksum": {"algorithm": "sha256", "value": sha256_file(args.artifacts)},
        },
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
