#!/usr/bin/env python3
"""Merge an isolate's read-pair alignments and mark duplicates within each library.

PCR duplicates of one library can occur in every run that sequenced it, so
duplicates are marked across all read pairs of the same library. Reads of
different libraries are never duplicates of each other, even at identical
coordinates. `samtools markdup` compares whole files, and its
`--use-read-groups` option compares read-group IDs, which are one per read
pair rather than one per library; so each library is merged and marked on
its own, and the marked libraries are then merged into the isolate's BAM.

Reads each pair's library (`LB`) from its read-validation report, runs
samtools from the rule's environment, and writes:

  --output   the merged, coordinate-sorted, duplicate-marked BAM and its index
  --metrics  JSON: per library, its read groups and samtools markdup statistics

Standard library only; samtools must be on PATH.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
# The exact samtools markdup options, recorded in the metrics with its statistics.
MARKDUP_OPTIONS = ["--mode", "t"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def run(command: list[str]) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, check=True)


def libraries_of(pairs: list[tuple[Path, Path]]) -> dict[str, list[tuple[Path, dict]]]:
    """Groups the pair BAMs by library, keeping the snapshot's pair order within each."""
    libraries: dict[str, list[tuple[Path, dict]]] = {}
    seen_ids: set[str] = set()
    for bam, report_path in pairs:
        read_group = json.loads(report_path.read_text(encoding="utf-8"))["read_group"]
        if read_group["id"] in seen_ids:
            raise SystemExit(
                f"read group {read_group['id']} occurs in two read pairs of this isolate; "
                "the same lane and barcode must not be listed twice"
            )
        seen_ids.add(read_group["id"])
        libraries.setdefault(read_group["lb"], []).append((bam, read_group))
    return libraries


def merge(inputs: list[Path], output: Path, threads: int) -> None:
    if len(inputs) == 1:
        shutil.copyfile(inputs[0], output)
    else:
        run(["samtools", "merge", "-@", str(threads), "-f", "-o", str(output), *map(str, inputs)])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pair", nargs=2, action="append", required=True, type=Path,
                        metavar=("BAM", "READ_VALIDATION_JSON"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=1)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    libraries = libraries_of([tuple(pair) for pair in args.pair])
    shutil.rmtree(args.work_dir, ignore_errors=True)
    args.work_dir.mkdir(parents=True)
    marked, library_metrics = [], []
    for number, (library, members) in enumerate(sorted(libraries.items()), start=1):
        merged = args.work_dir / f"library-{number}.bam"
        merge([bam for bam, _ in members], merged, args.threads)
        output = args.work_dir / f"library-{number}.marked.bam"
        stats = args.work_dir / f"library-{number}.markdup.json"
        run(["samtools", "markdup", "-@", str(args.threads), *MARKDUP_OPTIONS, "--json", "-f", str(stats),
             str(merged), str(output)])
        marked.append(output)
        library_metrics.append({
            "library": library,
            "read_groups": [read_group["id"] for _, read_group in members],
            "markdup": json.loads(stats.read_text(encoding="utf-8")),
        })
    merge(marked, args.output, args.threads)
    run(["samtools", "index", "-@", str(args.threads), str(args.output)])
    run(["samtools", "quickcheck", "-v", str(args.output)])
    shutil.rmtree(args.work_dir)

    args.metrics.write_text(
        json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": utc_now_iso(),
                "markdup_options": MARKDUP_OPTIONS,
                "libraries": library_metrics,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
