#!/usr/bin/env python3
"""Classify every backbone position of one isolate as callable, ambiguous, or uncallable.

Reads the isolate's all-sites calls as `bcftools query` text on standard
input, one record per line:

  CHROM  POS  REF  ALT  AD      (ALT is `.` for a reference-only record)

Depth is the sum of the record's allele depths (`FORMAT/AD`): the reads left
after the mapping-quality, base-quality, and duplicate filters of the call.

  callable    depth >= --min-depth and one allele has at least
              --min-allele-fraction of it
  ambiguous   depth >= --min-depth, but no allele reaches that fraction
  uncallable  anything else, including positions without any record because
              no usable read covers them

Indel records refine the positions they span, after the per-position records
are classified:

  - an indel whose allele reaches the fraction is callable; a callable
    deletion makes the backbone bases it removes callable, because their own
    records have no reads (the reads carry the deletion);
  - an indel whose allele has more than `1 - fraction` but less than the
    fraction is ambiguous, and so are the backbone bases it spans (its
    anchor base for an insertion);
  - a smaller indel allele is noise and changes nothing.

Writes:
  --mask            BED: every backbone base in one interval per run of a state
                    (chrom, 0-based start, end, state), in backbone order
  --consensus-mask  BED: the ambiguous and uncallable intervals only, merged,
                    for `bcftools consensus --mask`
  --summary         JSON: bases per state, per contig and in total

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, TextIO

SCHEMA_VERSION = 1
UNCALLABLE, AMBIGUOUS, CALLABLE = 0, 1, 2
STATE_NAMES = {UNCALLABLE: "uncallable", AMBIGUOUS: "ambiguous", CALLABLE: "callable"}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def read_fai(path: Path) -> list[tuple[str, int]]:
    contigs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line:
            name, length = line.split("\t")[:2]
            contigs.append((name, int(length)))
    return contigs


def allele_depths(field: str) -> list[int] | None:
    if field in ("", "."):
        return None
    try:
        return [int(value) for value in field.split(",")]
    except ValueError:
        return None


def classify(
    records: Iterable[str],
    contigs: list[tuple[str, int]],
    min_depth: int,
    min_allele_fraction: float,
) -> dict[str, bytearray]:
    states = {name: bytearray(length) for name, length in contigs}
    callable_spans: list[tuple[str, int, int]] = []
    ambiguous_spans: list[tuple[str, int, int]] = []
    for line in records:
        line = line.rstrip("\n")
        if not line:
            continue
        chrom, position, ref, alt, ad = line.split("\t")
        depths = allele_depths(ad)
        state = states.get(chrom)
        if state is None or depths is None:
            continue
        start = int(position) - 1
        depth = sum(depths)
        alts = [] if alt == "." else alt.split(",")
        if any(len(allele) != len(ref) for allele in alts):
            if depth < min_depth or len(depths) < 2:
                continue
            fraction = max(depths[1:]) / depth
            span_end = start + len(ref)
            if fraction >= min_allele_fraction:
                if len(ref) > 1:
                    callable_spans.append((chrom, start + 1, span_end))
            elif fraction > 1 - min_allele_fraction:
                ambiguous_spans.append((chrom, start, span_end))
            continue
        if depth < min_depth:
            continue
        # A reference record and a variant record may share a position; the better
        # classification of the two stands.
        classification = CALLABLE if max(depths) / depth >= min_allele_fraction else AMBIGUOUS
        for offset in range(len(ref)):
            if start + offset < len(state):
                state[start + offset] = max(state[start + offset], classification)
    for chrom, start, end in callable_spans:
        states[chrom][start:end] = bytes([CALLABLE]) * (end - start)
    for chrom, start, end in ambiguous_spans:
        states[chrom][start:end] = bytes([AMBIGUOUS]) * (end - start)
    return states


def intervals(state: bytearray) -> Iterable[tuple[int, int, int]]:
    """Yields (start, end, state) for every run of one state."""
    start = 0
    for index in range(1, len(state) + 1):
        if index == len(state) or state[index] != state[start]:
            yield start, index, state[start]
            start = index


def write_outputs(
    states: dict[str, bytearray],
    contigs: list[tuple[str, int]],
    mask: TextIO,
    consensus_mask: TextIO,
) -> dict:
    totals = {name: 0 for name in STATE_NAMES.values()}
    per_contig = {}
    for chrom, length in contigs:
        counts = {name: 0 for name in STATE_NAMES.values()}
        pending: tuple[int, int] | None = None
        for start, end, state in intervals(states[chrom]):
            name = STATE_NAMES[state]
            counts[name] += end - start
            mask.write(f"{chrom}\t{start}\t{end}\t{name}\n")
            if state == CALLABLE:
                if pending:
                    consensus_mask.write(f"{chrom}\t{pending[0]}\t{pending[1]}\n")
                pending = None
            else:
                pending = (pending[0], end) if pending else (start, end)
        if pending:
            consensus_mask.write(f"{chrom}\t{pending[0]}\t{pending[1]}\n")
        per_contig[chrom] = {"length": length, **counts}
        for name, count in counts.items():
            totals[name] += count
    genome = sum(length for _, length in contigs)
    return {
        "bases": totals,
        "genome_length": genome,
        "callable_fraction": round(totals["callable"] / genome, 6) if genome else 0.0,
        "contigs": per_contig,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fai", type=Path, required=True)
    parser.add_argument("--min-depth", type=int, required=True)
    parser.add_argument("--min-allele-fraction", type=float, required=True)
    parser.add_argument("--mask", type=Path, required=True)
    parser.add_argument("--consensus-mask", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    contigs = read_fai(args.fai)
    states = classify(sys.stdin, contigs, args.min_depth, args.min_allele_fraction)
    with args.mask.open("w", encoding="utf-8") as mask, args.consensus_mask.open("w", encoding="utf-8") as consensus:
        summary = write_outputs(states, contigs, mask, consensus)
    args.summary.write_text(
        json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": utc_now_iso(),
                "thresholds": {
                    "min_depth": args.min_depth,
                    "min_allele_fraction": args.min_allele_fraction,
                },
                **summary,
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
