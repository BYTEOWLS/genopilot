#!/usr/bin/env python3
"""Compare local genome files without loading their sequences into memory."""

import argparse
from collections import Counter
import gzip
import hashlib
from itertools import zip_longest
import json
from pathlib import Path
import sys
import zlib


FASTA_SUFFIXES = {".fa", ".fas", ".fasta", ".fna", ".faa", ".ffn", ".frn"}


def open_text(path):
    with path.open("rb") as probe:
        compressed = probe.read(2) == b"\x1f\x8b"
    opener = gzip.open if compressed else open
    return opener(path, "rt", encoding="utf-8")


def file_facts(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size,
            "sha256": digest.hexdigest()}


def fasta_index(lines):
    records = {}
    identifier = None
    header = None
    digest = None
    length = 0

    def save():
        if identifier is not None:
            if length == 0:
                raise ValueError(f"empty FASTA sequence: {identifier}")
            records[identifier] = (length, digest.hexdigest(), header)

    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            save()
            header = line[1:].strip()
            if not header:
                raise ValueError(f"empty FASTA header at line {number}")
            identifier = header.split()[0]
            if identifier in records:
                raise ValueError(f"duplicate FASTA ID: {identifier}")
            digest = hashlib.sha256()
            length = 0
        else:
            if identifier is None:
                raise ValueError(f"sequence before FASTA header at line {number}")
            # Keep case: soft masking can matter to downstream tools.
            sequence = "".join(line.split()).encode("ascii")
            digest.update(sequence)
            length += len(sequence)
    save()
    return records


def compare_fasta(left, right, limit):
    left_only = left.keys() - right.keys()
    right_only = right.keys() - left.keys()
    common = left.keys() & right.keys()
    changed = sorted(key for key in common if left[key][:2] != right[key][:2])
    headers = sorted(key for key in common if left[key][2] != right[key][2])
    return {
        "equal": not (left_only or right_only or changed or headers),
        "sequences_equal": not (left_only or right_only or changed),
        "left_records": len(left), "right_records": len(right),
        "left_bases_or_residues": sum(row[0] for row in left.values()),
        "right_bases_or_residues": sum(row[0] for row in right.values()),
        "unchanged_sequences": len(common) - len(changed),
        "left_only": {"count": len(left_only), "examples": sorted(left_only)[:limit]},
        "right_only": {"count": len(right_only), "examples": sorted(right_only)[:limit]},
        "changed_sequences": {"count": len(changed), "examples": [
            {"id": key, "left_length": left[key][0], "right_length": right[key][0],
             "left_sha256": left[key][1], "right_sha256": right[key][1]}
            for key in changed[:limit]]},
        "changed_headers": {"count": len(headers), "examples": headers[:limit]},
    }


def gff_rows(lines):
    for number, raw in enumerate(lines, 1):
        line = raw.rstrip("\r\n")
        if line == "##FASTA":
            return
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 9:
            raise ValueError(f"GFF line {number}: expected 9 tab-separated columns")
        # Attribute order is presentation; values, escaping and list order stay exact.
        fields[8] = ";".join(sorted(part for part in fields[8].split(";") if part))
        yield "\t".join(fields)


def row_hash(row):
    return hashlib.sha256(row.encode("utf-8")).digest()


def gff_index(path):
    with open_text(path) as handle:
        rows = Counter(row_hash(row) for row in gff_rows(handle))
        # gff_rows leaves the iterator just after ##FASTA, or at EOF.
        sequences = fasta_index(handle)
    if not rows:
        raise ValueError(f"GFF input contains no features: {path}")
    return rows, sequences


def row_difference(path, counts, limit):
    examples = []
    remaining = counts.copy()
    with open_text(path) as handle:
        for row in gff_rows(handle):
            key = row_hash(row)
            if remaining[key] > 0:
                examples.append(row)
                remaining[key] -= 1
                if len(examples) >= limit:
                    break
    return {"count": sum(counts.values()), "examples": examples}


def compare_gff(left, right, limit):
    left_rows, left_fasta = gff_index(left)
    right_rows, right_fasta = gff_index(right)
    removed = left_rows - right_rows
    added = right_rows - left_rows
    embedded = compare_fasta(left_fasta, right_fasta, limit)
    return {
        "equal": not (removed or added) and embedded["equal"],
        "left_features": sum(left_rows.values()),
        "right_features": sum(right_rows.values()),
        "unchanged_features": sum((left_rows & right_rows).values()),
        "left_only_rows": row_difference(left, removed, limit) if removed and limit else
            {"count": sum(removed.values()), "examples": []},
        "right_only_rows": row_difference(right, added, limit) if added and limit else
            {"count": sum(added.values()), "examples": []},
        "embedded_fasta": embedded,
    }


def compare_text(left, right, limit):
    differences = 0
    examples = []
    with open_text(left) as a, open_text(right) as b:
        for number, (first, second) in enumerate(zip_longest(a, b), 1):
            first = first.rstrip("\r\n") if first is not None else None
            second = second.rstrip("\r\n") if second is not None else None
            if first != second:
                differences += 1
                if len(examples) < limit:
                    examples.append({"line": number, "left": first, "right": second})
    return {"equal": differences == 0, "different_line_positions": differences,
            "examples": examples}


def detect_format(path):
    suffixes = path.suffixes
    suffix = suffixes[-2] if suffixes[-1:] == [".gz"] and len(suffixes) > 1 else path.suffix
    if suffix.lower() in FASTA_SUFFIXES:
        return "fasta"
    if suffix.lower() in {".gff", ".gff3"}:
        return "gff"
    return "text"


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=(
        "JSON report on stdout. Exit 0: normalized content equal; 1: differences; "
        "2: error. Raw SHA-256 covers compressed bytes, when applicable. "
        "Inputs must remain unchanged during comparison."))
    parser.add_argument("left", type=Path)
    parser.add_argument("right", type=Path)
    parser.add_argument("--format", choices=["auto", "fasta", "gff", "text"], default="auto")
    parser.add_argument("--limit", type=int, default=10, help="maximum examples per category (default: 10)")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("--limit must be nonnegative")
    try:
        kind = args.format
        if kind == "auto":
            kind = detect_format(args.left)
            if kind != detect_format(args.right):
                raise ValueError("file formats differ; specify --format explicitly")
        facts = [file_facts(path) for path in (args.left, args.right)]
        if kind == "fasta":
            with open_text(args.left) as a, open_text(args.right) as b:
                first, second = fasta_index(a), fasta_index(b)
            if not first or not second:
                raise ValueError("FASTA input contains no records")
            comparison = compare_fasta(first, second, args.limit)
        elif kind == "gff":
            comparison = compare_gff(args.left, args.right, args.limit)
        else:
            comparison = compare_text(args.left, args.right, args.limit)
        report = {"format": kind, "left": facts[0], "right": facts[1],
                  "bytes_equal": facts[0]["sha256"] == facts[1]["sha256"],
                  "comparison": comparison}
        json.dump(report, sys.stdout, indent=2, ensure_ascii=True)
        print()
        return 0 if comparison["equal"] else 1
    except (OSError, ValueError, EOFError, zlib.error) as error:
        print(f"Comparison failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
