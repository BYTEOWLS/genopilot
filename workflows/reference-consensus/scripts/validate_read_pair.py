#!/usr/bin/env python3
"""Validate complete paired FASTQ files, checksum them, and record an Illumina read group.

Library identity comes from the user-confirmed snapshot, not filenames or headers.
Original Illumina headers supply optional sequencing metadata; archive headers are
also accepted. Every record's format, qualities, and mate name are checked here,
including provider-trimmed inputs that will not pass through fastp.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import sys
from itertools import zip_longest
from pathlib import Path
from typing import BinaryIO, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
from provenance import utc_now_iso  # noqa: E402

SCHEMA_VERSION = 1
MAX_REPORTED_ERRORS = 20
READ_GROUP_VALUE = re.compile(r"^[A-Za-z0-9._+-]+$")


class HashingReader(io.RawIOBase):
    def __init__(self, handle: BinaryIO) -> None:
        self._handle = handle
        self.digest = hashlib.sha256()
        self.size = 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        data = self._handle.read(len(buffer))
        buffer[:len(data)] = data
        self.digest.update(data)
        self.size += len(data)
        return len(data)


def records(hasher: HashingReader) -> Iterator[tuple[str, str]]:
    raw = io.BufferedReader(hasher)
    stream = gzip.GzipFile(fileobj=raw) if raw.peek(2)[:2] == b"\x1f\x8b" else raw
    lines = io.TextIOWrapper(stream, encoding="ascii", errors="strict", newline=None)
    while True:
        header = lines.readline()
        if not header:
            return
        sequence, plus, quality = (lines.readline().rstrip("\r\n") for _ in range(3))
        if not header.startswith("@") or not header[1:].strip() or not plus.startswith("+"):
            raise ValueError("invalid FASTQ header or separator, or incomplete record")
        if not sequence or not re.fullmatch(r"[ACGTNacgtn]+", sequence):
            raise ValueError("invalid or empty FASTQ sequence")
        if len(sequence) != len(quality) or any(ord(char) < 33 or ord(char) > 126 for char in quality):
            raise ValueError("FASTQ sequence and quality lengths differ or qualities are invalid")
        yield header.rstrip("\r\n"), sequence


def headers(hasher: HashingReader) -> Iterator[str]:
    for header, _ in records(hasher):
        yield header


def parse_illumina_name(header: str) -> dict | None:
    name = header[1:].split(maxsplit=1)[0] if header.startswith("@") and len(header) > 1 else ""
    fields = name.removesuffix("/1").removesuffix("/2").split(":")
    if len(fields) != 7:
        return None
    instrument, run, flowcell, lane, *position = fields
    if not instrument or not flowcell or not all(value.isdigit() for value in (run, lane, *position)):
        return None
    return {"instrument": instrument, "run": int(run), "flowcell": flowcell, "lane": int(lane)}


def barcode_from_header(header: str) -> str | None:
    parts = header.split(maxsplit=1)
    fields = parts[1].split()[0].split(":") if len(parts) > 1 else []
    return fields[3] if len(fields) == 4 and fields[3] else None


def mate_name(header: str, expected: int) -> str:
    fields = header[1:].split()
    name = fields[0]
    suffix = re.search(r"/([12])$", name)
    if suffix and int(suffix.group(1)) != expected:
        raise ValueError("read header has the wrong mate suffix")
    if len(fields) > 1 and re.match(r"^[12]:", fields[1]) and int(fields[1][0]) != expected:
        raise ValueError("read header has the wrong mate comment")
    return name.removesuffix("/1").removesuffix("/2")


def check(r1: Path, r2: Path) -> tuple[dict, dict | None, str | None, set[int], list[str]]:
    errors: list[str] = []
    first = None
    barcode = None
    barcodes: set[str | None] = set()
    header_kinds: set[bool] = set()
    lanes: set[int] = set()
    counts = {"r1": 0, "r2": 0}
    with r1.open("rb") as h1, r2.open("rb") as h2:
        hashers = {"r1": HashingReader(h1), "r2": HashingReader(h2)}
        try:
            for number, pair in enumerate(zip_longest(records(hashers["r1"]), records(hashers["r2"])), 1):
                left, right = pair
                counts["r1"] += int(left is not None)
                counts["r2"] += int(right is not None)
                if left is None or right is None:
                    errors.append(f"record {number}: mate record counts differ")
                elif mate_name(left[0], 1) != mate_name(right[0], 2):
                    errors.append(f"record {number}: mate names differ")
                else:
                    for header, _ in pair:
                        fields = parse_illumina_name(header)
                        header_kinds.add(fields is not None)
                        if len(header_kinds) > 1:
                            errors.append(f"record {number}: mixed original and archive header formats")
                        if fields is not None:
                            if first is None:
                                first, barcode = fields, barcode_from_header(header)
                            elif any(fields[key] != first[key] for key in ("instrument", "run", "flowcell")):
                                errors.append(f"record {number}: instrument, run, or flowcell differs")
                            barcodes.add(barcode_from_header(header))
                            lanes.add(fields["lane"])
                if len(errors) >= MAX_REPORTED_ERRORS:
                    break
        except (ValueError, OSError, EOFError) as error:
            errors.append(str(error))
        if counts["r1"] == 0:
            errors.append("the read pair holds no records")
        files = {mate: {"path": str(path), "sha256": hashers[mate].digest.hexdigest(), "bytes": hashers[mate].size,
                        "checksum_complete": not errors}
                 for mate, path in (("r1", r1), ("r2", r2))}
    # Sequencing errors can alter index comments. A varying index is not one known barcode.
    return files, first, barcode if len(barcodes) <= 1 else None, lanes, errors


def validate(isolate_id: str, pair: int, r1: Path, r2: Path, trimmed: bool,
             library_id: str, read_set_id: str, read_group_id: str, preprocessing: dict | None = None) -> dict:
    files, first, barcode, lanes, errors = check(r1, r2)
    for label, value in (("library ID", library_id), ("read-group ID", read_group_id), ("isolate ID", isolate_id)):
        if not READ_GROUP_VALUE.fullmatch(value):
            errors.append(f"invalid {label}")
    if barcode is not None and not READ_GROUP_VALUE.fullmatch(barcode):
        errors.append("invalid barcode")
    read_group = None
    if not errors:
        read_group = {"id": read_group_id, "sm": isolate_id, "lb": library_id, "pl": "ILLUMINA",
                      "library_source": "explicit", "id_source": "generated",
                      "sequencing_source": "headers" if first else "unavailable"}
        if first:
            suffix = f".{next(iter(lanes))}" if len(lanes) == 1 else ""
            read_group["pu"] = f"{first['flowcell']}{suffix}{'.' + barcode if barcode else ''}"
    return {"schema_version": SCHEMA_VERSION, "generated_at": utc_now_iso(),
            "status": "failed" if errors else "passed", "isolate_id": isolate_id,
            "read_set_id": read_set_id, "pair": pair, "trimmed": trimmed, "origin": "imported",
            "preprocessing": {"status": "skipped-provider-trimmed" if trimmed else "pending", "settings": preprocessing},
            "files": files, "sequencing": None if first is None else {**first, "lanes": sorted(lanes), "barcode": barcode},
            "read_group": read_group, "errors": errors}


def read_group_line(read_group: dict) -> str:
    return "\\t".join(["@RG", *(f"{tag}:{read_group[key]}" for tag, key in
        (("ID", "id"), ("PU", "pu"), ("SM", "sm"), ("LB", "lb"), ("PL", "pl")) if key in read_group)])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--isolate-id", required=True)
    parser.add_argument("--pair", type=int, required=True)
    parser.add_argument("--r1", type=Path, required=True)
    parser.add_argument("--r2", type=Path, required=True)
    parser.add_argument("--trimmed", choices=("trimmed", "untrimmed"), required=True)
    parser.add_argument("--library-id", required=True)
    parser.add_argument("--read-set-id", required=True)
    parser.add_argument("--read-group-id", required=True)
    parser.add_argument("--preprocessing-json", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--read-group", type=Path, required=True)
    args = parser.parse_args(argv)
    report = validate(args.isolate_id, args.pair, args.r1, args.r2, args.trimmed == "trimmed",
                      args.library_id, args.read_set_id, args.read_group_id, json.loads(args.preprocessing_json))
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(text, encoding="utf-8")
    if report["status"] != "passed":
        sys.stdout.write(text)
        return 1
    args.read_group.write_text(read_group_line(report["read_group"]) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
