#!/usr/bin/env python3
"""Deterministically prefix GFF3 identifier attributes after LiftOn.

Rewrites only the `ID`, `Parent`, and `Derives_from` attribute values (each
may be a comma-separated list per the GFF3 spec), leaving every other
column and attribute — descriptions, `Name`, `Dbxref`, `product`,
`protein_id`, and so on — byte-identical. The raw LiftOn GFF3 is never
modified in place; this always writes a separate file.

A feature with no `ID` (for example many `exon` rows) is left alone: there
is nothing to prefix, and one is never synthesized. A feature line whose
column count is not exactly 9 (comments, blank lines, or a malformed row)
is copied through verbatim; structural well-formedness is the validate
stage's job, not this one's.

A prefix is required and must not be empty. An unprefixed run skips this
step entirely — `prefix_annotation.smk` does not define its rule and
downstream stages consume the raw LiftOn GFF3 — so being asked to write a
"prefixed" file with nothing to prefix means the caller is wrong.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_PREFIXABLE_ATTRIBUTES = ("ID", "Parent", "Derives_from")


def apply_prefix_to_attributes(raw_attributes: str, prefix: str) -> str:
    segments = raw_attributes.split(";")
    rewritten = []
    for segment in segments:
        if "=" not in segment:
            rewritten.append(segment)
            continue
        key, _, value = segment.partition("=")
        if key in _PREFIXABLE_ATTRIBUTES and value:
            new_value = ",".join(
                f"{prefix}{piece}" if piece else piece for piece in value.split(",")
            )
            rewritten.append(f"{key}={new_value}")
        else:
            rewritten.append(segment)
    return ";".join(rewritten)


def prefix_gff3_line(line: str, prefix: str) -> str:
    if line.startswith("#") or line.strip() == "":
        return line
    columns = line.split("\t")
    if len(columns) != 9:
        return line
    columns[8] = apply_prefix_to_attributes(columns[8], prefix)
    return "\t".join(columns)


def prefix_gff3(source: Path, destination: Path, prefix: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with (
        open(source, encoding="utf-8") as handle_in,
        open(destination, "w", encoding="utf-8") as handle_out,
    ):
        for raw_line in handle_in:
            handle_out.write(prefix_gff3_line(raw_line.rstrip("\n"), prefix))
            handle_out.write("\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--prefix", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not args.prefix:
        print("--prefix must not be empty", file=sys.stderr)
        return 2
    prefix_gff3(args.source, args.destination, args.prefix)
    return 0


if __name__ == "__main__":
    sys.exit(main())
