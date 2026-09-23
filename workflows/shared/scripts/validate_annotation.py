#!/usr/bin/env python3
"""Validate the prefixed GFF3 produced by the LiftOn + prefixing stages.

Reuses `validate_inputs.parse_gff3` (structural/hierarchy checks: IDs,
Parent references, coordinates, strand, CDS phase) against the one file
that matters at this point in the DAG, the prefixed annotation. Emits the
`annotation-validation` artifact (see manifest.yaml). Always exits 0 so a
"failed" report is preserved as evidence rather than deleted by Snakemake;
see validate_inputs.py for the same rationale.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_inputs import Gff3Result, parse_gff3, utc_now_iso  # noqa: E402

SCHEMA_VERSION = 1


def build_summary(gff3_path: Path, result: Gff3Result) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "status": "passed" if not result.errors else "failed",
        "gff3": {
            "path": str(gff3_path),
            "feature_count": result.feature_count,
            "feature_types": result.feature_types,
            "errors": result.errors,
            "warnings": result.warnings,
        },
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gff3", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = parse_gff3(args.gff3)
    summary = build_summary(args.gff3, result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
