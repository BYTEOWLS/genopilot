"""Writes reference-consensus run directories that use the synthetic fixtures.

`write_run` saves a `config.yaml` and `isolates.yaml` shaped exactly like the
ones GenoPilot saves, selecting fixture isolates by ID (see
`tests/fixtures/reference-consensus/README.md`) plus any extra isolates a test
builds itself.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..annotation_transfer._load import PROJECT_ROOT

FIXTURES_DIR = PROJECT_ROOT / "tests" / "fixtures" / "reference-consensus"
EXPECTED = json.loads((FIXTURES_DIR / "expected.json").read_text(encoding="utf-8"))

DEFAULT_CALLING = {
    "ploidy": 1,
    "min_depth": 10,
    "min_mapping_quality": 20,
    "min_base_quality": 20,
    "min_allele_fraction": 0.8,
}


def fixture_isolate(isolate_id: str) -> dict:
    return {
        "id": isolate_id,
        "read_pairs": [
            {"r1": str(FIXTURES_DIR / pair["r1"]), "r2": str(FIXTURES_DIR / pair["r2"]), "trimmed": pair["trimmed"]}
            for pair in EXPECTED["isolates"][isolate_id]["read_pairs"]
        ],
    }


def write_run(
    run_dir: Path,
    isolate_ids: list[str],
    extra_isolates: list[dict] | None = None,
    calling: dict | None = None,
    effective_cpus: int = 2,
) -> Path:
    """Writes config.yaml and isolates.yaml into `run_dir` and returns the config path."""
    run_dir.mkdir(parents=True, exist_ok=True)
    isolates = [fixture_isolate(isolate_id) for isolate_id in isolate_ids] + (extra_isolates or [])
    snapshot = {
        "schema_version": 1,
        "captured_at": "2026-09-25T10:00:00.000Z",
        "isolates": [
            {"id": isolate["id"], "name": isolate["id"], "wildtype": None, "derived_from": None,
             "read_pairs": isolate["read_pairs"]}
            for isolate in isolates
        ],
    }
    # JSON is valid YAML, so the snapshot and configuration need no YAML writer.
    (run_dir / "isolates.yaml").write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    config = {
        "schema_version": 1,
        "workflow_id": "reference-consensus",
        "workflow_version": 1,
        "inputs": {
            "backbone": {"source": "local", "fasta": str(FIXTURES_DIR / "backbone.fasta")},
            "isolates_file": "isolates.yaml",
            "selected_isolates": [isolate["id"] for isolate in isolates],
        },
        "calling": {**DEFAULT_CALLING, **(calling or {})},
        "consensus": {"include_backbone_vote": True, "voting_method": "strict-majority"},
        "resources": {"cpu_mode": "automatic", "effective_cpus": effective_cpus},
        "run": {
            "output_root": str(run_dir.parent),
            "id": run_dir.name,
            "created_at": "2026-09-25T10:00:00.000Z",
        },
    }
    config_path = run_dir / "config.yaml"
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return config_path
