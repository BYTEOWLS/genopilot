#!/usr/bin/env python3
"""Write the annotation-transfer artifact index and run provenance records.

Runs last, after the scientific summary, so direct workflow execution has
the same provenance contract as TUI-driven execution:

  --artifacts   every artifact of the run with its checksum, size, stage,
                and origin, plus the workflow, its manifest checksum, and the
                effective configuration's checksum (JSON, which is valid YAML)
  --provenance  the run and its effective configuration, requested and
                effective resources, the command of every stage, configured
                and observed tool versions, and the provenance of the resolved
                reference and target inputs

Its checksum, JSON, and configured-version helpers are also imported by
reference-consensus's collect_consensus_provenance.py.

Only Python's standard library is used by the implementation and its tests.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

SCHEMA_VERSION = 1
CHECKSUM_ALGORITHM = "sha256"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_directory(path: Path) -> tuple[str, int, int]:
    """Hash relative names and bytes so a directory is one verifiable artifact."""
    digest = hashlib.sha256()
    file_count = 0
    size = 0
    for child in sorted(item for item in path.rglob("*") if item.is_file()):
        relative = child.relative_to(path).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        child_size = child.stat().st_size
        digest.update(child_size.to_bytes(8, "big"))
        with child.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        file_count += 1
        size += child_size
    return digest.hexdigest(), file_count, size


def canonical_json_checksum(value: object) -> dict[str, str]:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"algorithm": CHECKSUM_ALGORITHM, "value": hashlib.sha256(encoded).hexdigest()}


def checksum_record(path: Path) -> tuple[dict[str, str], dict[str, int]]:
    if path.is_dir():
        value, file_count, size = sha256_directory(path)
        return (
            {"algorithm": CHECKSUM_ALGORITHM, "value": value},
            {"file_count": file_count, "size_bytes": size},
        )
    return (
        {"algorithm": CHECKSUM_ALGORITHM, "value": sha256_file(path)},
        {"size_bytes": path.stat().st_size},
    )


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object in {path}")
    return value


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def artifact_record(
    artifact_id: str,
    path: Path,
    artifact_type: str,
    stage: str,
    origin: str,
    source_provenance: str | None = None,
) -> dict:
    checksum, measurements = checksum_record(path)
    record = {
        "id": artifact_id,
        "path": path.as_posix(),
        "type": artifact_type,
        "stage": stage,
        "origin": origin,
        "checksum": checksum,
        "modified_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace(
            "+00:00", "Z"
        ),
        **measurements,
    }
    if source_provenance:
        record["source_provenance"] = source_provenance
    return record


def observed_tool_versions(run: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> dict:
    versions: dict[str, dict[str, str]] = {
        "python": {"version": platform.python_version(), "source": "runtime"}
    }
    for package in ("lifton", "parasail"):
        try:
            versions[package] = {"version": importlib.metadata.version(package), "source": "installed-package"}
        except importlib.metadata.PackageNotFoundError:
            versions[package] = {"status": "unavailable", "reason": "package metadata not found"}
    for binary in ("miniprot", "minimap2"):
        try:
            result = run([binary, "--version"], check=True, capture_output=True, text=True)
            text = (result.stdout or result.stderr).strip().splitlines()[0]
            versions[binary] = {"version": text, "source": "executable"}
        except (FileNotFoundError, subprocess.CalledProcessError, IndexError):
            versions[binary] = {"status": "unavailable", "reason": "version command failed"}
    return versions


ENVS_DIR = Path(__file__).resolve().parent.parent / "envs"
_PINNED_DEPENDENCY = re.compile(r"^\s*-\s+([A-Za-z0-9_.-]+)(?:==|=)([^\s=#]+)\s*(?:#.*)?$")


def configured_tool_versions(envs_dir: Path = ENVS_DIR) -> dict[str, str]:
    """Read the exact pins from the packaged rule environments.

    The environment files are the single source of pinned versions, so a bump there is
    recorded without further edits. Conda (`name=version`) and pip (`name==version`)
    pins are both read. A package pinned to different versions in two environments
    cannot be recorded as one configured version and is rejected.
    """
    versions: dict[str, str] = {}
    for environment in sorted(envs_dir.glob("*/environment.yaml")):
        for line in environment.read_text(encoding="utf-8").splitlines():
            match = _PINNED_DEPENDENCY.match(line)
            if not match:
                continue
            name, version = match.groups()
            if versions.setdefault(name, version) != version:
                raise ValueError(
                    f"{name} is pinned to both {versions[name]} and {version} "
                    f"across the rule environments in {envs_dir}"
                )
    return versions


def relevant_configuration(config: dict, stage: str) -> dict:
    common = {
        "schema_version": config["schema_version"],
        "workflow_id": config["workflow_id"],
        "workflow_version": config["workflow_version"],
    }
    if stage == "resolve-inputs":
        return {**common, "inputs": config["inputs"], "output_root": config["run"]["output_root"]}
    if stage in {"validate-inputs", "transfer-annotation"}:
        value = {**common, "inputs": config["inputs"]}
        if stage == "transfer-annotation":
            value.update({"lifton": config["lifton"], "effective_cpus": config["resources"]["effective_cpus"]})
        return value
    if stage == "validate-annotation":
        return common
    return config


def producer_record(config: dict, stage: str) -> dict:
    stage_tools = {
        "resolve-inputs": ["python", "ncbi-datasets-cli"],
        "validate-inputs": ["python"],
        "transfer-annotation": ["lifton", "miniprot", "minimap2", "parasail-python"],
        "validate-annotation": ["python"],
        "summarize-results": ["python"],
        "record-provenance": ["python"],
    }
    configured = configured_tool_versions()
    return {
        "workflow": {"id": config["workflow_id"], "version": config["workflow_version"]},
        "tools": {name: configured[name] for name in stage_tools[stage]},
    }


def build_artifacts(config: dict) -> list[dict]:
    input_specs = [
        ("resolved-reference-fasta", Path("resolved/reference.fasta"), "fasta", "provenance/reference.fasta.json"),
        ("resolved-reference-gff3", Path("resolved/reference.gff3"), "gff3", "provenance/reference.gff3.json"),
        ("resolved-target-fasta", Path("resolved/target.fasta"), "fasta", "provenance/target.fasta.json"),
    ]
    artifacts: list[dict] = []
    for artifact_id, path, artifact_type, provenance_path in input_specs:
        source = read_json(Path(provenance_path))
        artifacts.append(
            artifact_record(
                artifact_id,
                path,
                artifact_type,
                "resolve-inputs",
                source["origin"],
                provenance_path,
            )
        )

    generated = [
        ("input-validation", "results/input-validation.json", "json", "validate-inputs"),
        ("raw-gff3", "results/annotation/lifton.raw.gff3", "gff3", "transfer-annotation"),
        ("lifton-diagnostics", "results/annotation/lifton_output", "directory", "transfer-annotation"),
        ("annotation-validation", "results/validation.json", "json", "validate-annotation"),
        ("feature-transfer", "results/feature-transfer.tsv", "tsv", "summarize-results"),
        ("transfer-metrics", "results/metrics.json", "json", "summarize-results"),
        ("completion-summary", "results/summary.json", "json", "summarize-results"),
        ("resolve-reference-log", "logs/resolve-reference.log", "log", "resolve-inputs"),
        ("resolve-target-log", "logs/resolve-target.log", "log", "resolve-inputs"),
        ("validate-inputs-log", "logs/validate-inputs.log", "log", "validate-inputs"),
        ("transfer-annotation-log", "logs/transfer-annotation.log", "log", "transfer-annotation"),
        ("transfer-annotation-benchmark", "logs/transfer-annotation.benchmark.tsv", "tsv", "transfer-annotation"),
        ("validate-annotation-log", "logs/validate-annotation.log", "log", "validate-annotation"),
        ("summarize-results-log", "logs/summarize-results.log", "log", "summarize-results"),
        ("record-provenance-log", "logs/record-provenance.log", "log", "record-provenance"),
    ]
    for artifact_id, path_text, artifact_type, stage in generated:
        artifacts.append(
            artifact_record(artifact_id, Path(path_text), artifact_type, stage, "generated")
        )
    for record in artifacts:
        stage = record["stage"]
        record["configuration_checksum"] = canonical_json_checksum(
            relevant_configuration(config, stage)
        )
        record["producer"] = producer_record(config, stage)
    return artifacts


def _resolve_command(config: dict, role: str) -> dict:
    source = config["inputs"][role]
    argv = [
        "python3",
        "resolve_input.py",
        "--role",
        role,
        "--source-type",
        source["source"],
        "--fasta-destination",
        f"resolved/{role}.fasta",
        "--fasta-provenance",
        f"provenance/{role}.fasta.json",
    ]
    if role == "reference":
        argv += [
            "--gff3-destination",
            "resolved/reference.gff3",
            "--gff3-provenance",
            "provenance/reference.gff3.json",
        ]
    if source["source"] == "local":
        argv += ["--local-fasta", source["fasta"]]
        if role == "reference":
            argv += ["--local-gff3", source["gff3"]]
    else:
        argv += [
            "--accession",
            source["accession"],
            "--cache-dir",
            str(Path(config["run"]["output_root"]) / "ncbi-accessions-cache"),
            "--cache-mode",
            source.get("ncbi_cache_mode", "reuse"),
        ]
    return {"rule": f"resolve_{role}", "argv": argv}


def build_commands(config: dict) -> list[dict]:
    return [
        _resolve_command(config, "reference"),
        _resolve_command(config, "target"),
        {
            "rule": "validate_inputs",
            "argv": [
                "python3",
                "validate_inputs.py",
                "--reference-fasta",
                "resolved/reference.fasta",
                "--reference-gff3",
                "resolved/reference.gff3",
                "--target-fasta",
                "resolved/target.fasta",
                "--output",
                "results/input-validation.json",
            ],
        },
        {
            "rule": "transfer_annotation",
            "argv": [
                "lifton",
                "resolved/target.fasta",
                "resolved/reference.fasta",
                "-g",
                "resolved/reference.gff3",
                "-o",
                "results/annotation/lifton.raw.gff3",
                "-t",
                str(config["resources"]["effective_cpus"]),
            ],
        },
        {
            "rule": "validate_annotation",
            "argv": [
                "python3",
                "validate_annotation.py",
                "--gff3",
                "results/annotation/lifton.raw.gff3",
                "--output",
                "results/validation.json",
            ],
        },
        {
            "rule": "summarize_annotation_transfer",
            "argv": [
                "python3",
                "collect_transfer_metrics.py",
                "--reference-gff3",
                "resolved/reference.gff3",
                "--raw-gff3",
                "results/annotation/lifton.raw.gff3",
                "--validation",
                "results/validation.json",
                "--diagnostics",
                "results/annotation/lifton_output",
                "--details",
                "results/feature-transfer.tsv",
                "--metrics",
                "results/metrics.json",
                "--summary",
                "results/summary.json",
                "--workflow-id",
                config["workflow_id"],
                "--workflow-version",
                str(config["workflow_version"]),
                "--run-id",
                config["run"]["id"],
                "--run-created-at",
                config["run"]["created_at"],
                "--effective-cpus",
                str(config["resources"]["effective_cpus"]),
            ],
        },
    ]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--manifest-schema-version", type=int, required=True)
    parser.add_argument("--snakemake-version", required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    config = json.loads(args.config_json)
    generated_at = utc_now_iso()
    artifacts = build_artifacts(config)
    manifest_checksum = {"algorithm": CHECKSUM_ALGORITHM, "value": sha256_file(args.manifest)}
    workflow = {
        "id": config["workflow_id"],
        "version": config["workflow_version"],
        "manifest_schema_version": args.manifest_schema_version,
        "manifest_checksum": manifest_checksum,
    }
    artifacts_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "workflow": workflow,
        "effective_configuration_checksum": canonical_json_checksum(config),
        "artifacts": artifacts,
    }
    # JSON is deliberately used here: it is valid YAML while remaining writable and testable
    # with the standard library used by all shared workflow scripts.
    write_json(args.artifacts, artifacts_payload)

    input_provenance = {
        name: read_json(Path(f"provenance/{name}.json"))
        for name in ("reference.fasta", "reference.gff3", "target.fasta")
    }
    provenance_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "workflow": workflow,
        "run": config["run"],
        "effective_configuration": config,
        "resources": {
            "requested": {
                "cpu_mode": config["resources"]["cpu_mode"],
                **(
                    {"manual_limit": config["resources"]["manual_limit"]}
                    if "manual_limit" in config["resources"]
                    else {}
                ),
            },
            "effective_cpus": config["resources"]["effective_cpus"],
            "benchmark": "logs/transfer-annotation.benchmark.tsv",
        },
        "commands": build_commands(config),
        "tool_versions": {
            "configured": configured_tool_versions(),
            "observed": {
                **observed_tool_versions(),
                "snakemake": {"version": args.snakemake_version, "source": "workflow-runtime"},
            },
            "input_resolution": {
                key: value.get("datasets_cli_version")
                for key, value in input_provenance.items()
                if value.get("datasets_cli_version")
            },
        },
        "inputs": input_provenance,
        "artifact_index": {
            "path": args.artifacts.as_posix(),
            "checksum": {"algorithm": CHECKSUM_ALGORITHM, "value": sha256_file(args.artifacts)},
        },
    }
    write_json(args.provenance, provenance_payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
