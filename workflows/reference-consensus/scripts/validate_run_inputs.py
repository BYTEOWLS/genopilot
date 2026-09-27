#!/usr/bin/env python3
"""Validate a consensus run's inputs before any per-isolate processing.

Checks the resolved backbone FASTA's structure and that every read file of
the run's isolate snapshot is a readable, non-empty file, and emits the
`input-validation` artifact (see the reference-consensus manifest.yaml).
Full FASTQ and mate validation belongs to per-isolate processing. Kept
dependency-free (standard library only); the snapshot arrives as arguments
because the including Snakefile has already parsed it.

Unlike the annotation-transfer input validation, no later stage gates on
this report yet, so a failed validation also fails the job. The report is
then printed to the job log, which Snakemake keeps, as the evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# The FASTA parser is shared with annotation-transfer.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))

from validate_inputs import parse_fasta  # noqa: E402

SCHEMA_VERSION = 1


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def check_read_file(path: Path) -> str | None:
    """Returns why a read file cannot be used, or None when it can."""
    if not path.is_absolute():
        return "not an absolute path"
    if not path.exists():
        return "file not found"
    if not path.is_file():
        return "not a regular file"
    if not os.access(path, os.R_OK):
        return "file cannot be read"
    if path.stat().st_size == 0:
        return "file is empty"
    return None


def build_summary(backbone_path: Path, read_pairs: list[list[str]]) -> dict:
    backbone = parse_fasta(backbone_path)
    isolates: dict[str, dict] = {}
    for isolate_id, r1, r2, trimmed in read_pairs:
        entry = isolates.setdefault(isolate_id, {"read_pairs": [], "errors": []})
        pair_number = len(entry["read_pairs"]) + 1
        entry["read_pairs"].append({"r1": r1, "r2": r2, "trimmed": trimmed == "trimmed"})
        for mate, path in (("R1", r1), ("R2", r2)):
            problem = check_read_file(Path(path))
            if problem:
                entry["errors"].append(f"pair {pair_number} {mate}: {problem}: {path}")
    passed = not backbone.errors and all(not entry["errors"] for entry in isolates.values())
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "status": "passed" if passed else "failed",
        "backbone_fasta": {
            "path": str(backbone_path),
            "sequence_count": len(backbone.sequence_ids),
            "sequence_lengths": backbone.sequence_lengths,
            "errors": backbone.errors,
            "warnings": backbone.warnings,
        },
        "isolates": isolates,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backbone-fasta", type=Path, required=True)
    parser.add_argument(
        "--read-pair",
        nargs=4,
        action="append",
        default=[],
        metavar=("ISOLATE_ID", "R1", "R2", "TRIMMED"),
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.read_pair:
        parser.error("at least one --read-pair is required")
    for _, _, _, trimmed in args.read_pair:
        if trimmed not in ("trimmed", "untrimmed"):
            parser.error("TRIMMED must be 'trimmed' or 'untrimmed'")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    summary = build_summary(args.backbone_fasta, args.read_pair)
    report = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    if summary["status"] != "passed":
        sys.stdout.write(report)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
