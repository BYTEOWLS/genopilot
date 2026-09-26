#!/usr/bin/env python3
"""Validate one R1/R2 read pair completely and derive its read group.

Reads both FASTQ files (plain or gzip) record by record and checks that:

  - every record has a header, bases, a `+` separator, and qualities of the
    same length, with only `ACGTN` bases and printable Phred+33 qualities;
  - R1 and R2 hold the same number of records, with the same read name at
    every position (a trailing `/1` or `/2` is ignored);
  - every read name is an Illumina read name
    (`<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>`) and agrees with
    the first one on instrument, run, and flowcell. Lanes may differ: a
    lane-merged delivery combines every lane of a flowcell in one file.

It also records the SHA-256 of both files as delivered, record and base
counts, and read-length statistics, and derives the read group:

  PU = ID  <flowcell>[.<lane>].<barcode>; the lane only when every record
           has the same one, the barcode from the first record's comment
  SM       the isolate ID
  LB       the Illumina sample name from the R1 file name
           (`<sample>_S<n>[_L<lane>]_R1_<chunk>.fastq.gz`), or the isolate ID
           when the file name does not follow that pattern, plus the barcode
  PL       ILLUMINA

Writes the report (JSON) and, only when the pair passed, the read group as
one `@RG` line with literal `\\t` separators, ready for `bwa mem -R`. A failed
validation also prints the report and exits non-zero, because Snakemake
removes the outputs of a failed job and keeps only its log.

Standard library only.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Iterator

SCHEMA_VERSION = 1
MAX_REPORTED_ERRORS = 20
ILLUMINA_FILE_NAME = re.compile(r"^(.+)_S(\d+)(?:_L(\d{3}))?_R1_(\d{3})\.fastq\.gz$")
READ_GROUP_VALUE = re.compile(r"^[A-Za-z0-9._+-]+$")
BASES = re.compile(r"^[ACGTN]+$")
QUALITIES = re.compile(r"^[!-~]+$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class HashingReader(io.RawIOBase):
    """Passes a file's bytes through while hashing and counting them."""

    def __init__(self, handle: BinaryIO) -> None:
        self._handle = handle
        self.digest = hashlib.sha256()
        self.size = 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        data = self._handle.read(len(buffer))
        buffer[: len(data)] = data
        self.digest.update(data)
        self.size += len(data)
        return len(data)


def open_lines(path: Path, hasher: HashingReader) -> Iterator[str]:
    """Yields the lines of a plain or gzip FASTQ file without line endings."""
    raw = io.BufferedReader(hasher)
    stream: BinaryIO = gzip.GzipFile(fileobj=raw) if raw.peek(2)[:2] == b"\x1f\x8b" else raw
    for line in io.TextIOWrapper(stream, encoding="ascii", errors="replace", newline=None):
        yield line.rstrip("\n")


def read_records(lines: Iterator[str]) -> Iterator[tuple[str, str, str, str] | str]:
    """Yields each record as four lines, or a message for a truncated final record."""
    while True:
        record = []
        for line in lines:
            record.append(line)
            if len(record) == 4:
                break
        if not record:
            return
        if len(record) < 4:
            yield f"the last record is truncated after {len(record)} line(s)"
            return
        yield tuple(record)  # type: ignore[misc]


@dataclass
class IlluminaName:
    read_name: str
    instrument: str
    run: int
    flowcell: str
    lane: int


def parse_illumina_header(header: str) -> tuple[IlluminaName | None, str | None]:
    """Parses `@<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y> <comment>`."""
    parts = header[1:].split(maxsplit=1)
    name = parts[0] if parts else ""
    if name.endswith(("/1", "/2")):
        name = name[:-2]
    comment = parts[1] if len(parts) > 1 else None
    fields = name.split(":")
    if len(fields) != 7:
        return None, comment
    instrument, run, flowcell, lane, *position = fields
    if not instrument or not flowcell or not all(value.isdigit() for value in (run, lane, *position)):
        return None, comment
    return IlluminaName(name, instrument, int(run), flowcell, int(lane)), comment


def barcode_from_comment(comment: str | None) -> str | None:
    """Returns the index field of an Illumina comment (`<read>:<filtered>:<control>:<index>`)."""
    if comment is None:
        return None
    fields = comment.split()[0].split(":")
    return fields[3] if len(fields) == 4 and fields[3] else None


@dataclass
class MateStats:
    records: int = 0
    bases: int = 0
    min_length: int | None = None
    max_length: int = 0

    def add(self, length: int) -> None:
        self.records += 1
        self.bases += length
        self.min_length = length if self.min_length is None else min(self.min_length, length)
        self.max_length = max(self.max_length, length)

    def to_json(self) -> dict:
        return {
            "records": self.records,
            "bases": self.bases,
            "min_length": self.min_length,
            "max_length": self.max_length,
            "mean_length": round(self.bases / self.records, 2) if self.records else None,
        }


@dataclass
class Validation:
    errors: list[str] = field(default_factory=list)
    suppressed_errors: int = 0

    def error(self, message: str) -> None:
        if len(self.errors) < MAX_REPORTED_ERRORS:
            self.errors.append(message)
        else:
            self.suppressed_errors += 1


def check_record(record: tuple[str, str, str, str], mate: str, number: int, validation: Validation) -> bool:
    header, bases, separator, qualities = record
    problems = []
    if not header.startswith("@") or len(header) < 2:
        problems.append("header does not start with '@'")
    if not BASES.match(bases):
        problems.append("bases other than A, C, G, T, N")
    if not separator.startswith("+"):
        problems.append("third line does not start with '+'")
    if not QUALITIES.match(qualities) or len(qualities) != len(bases):
        problems.append("qualities are not printable Phred+33 of the same length as the bases")
    for problem in problems:
        validation.error(f"{mate} record {number}: {problem}")
    return not problems


def library_sample_name(r1_path: Path, isolate_id: str) -> tuple[str, str]:
    match = ILLUMINA_FILE_NAME.match(r1_path.name)
    if match and READ_GROUP_VALUE.match(match.group(1)):
        return match.group(1), "illumina-file-name"
    return isolate_id, "isolate-id"


def validate(isolate_id: str, pair: int, r1: Path, r2: Path, trimmed: bool) -> dict:
    validation = Validation()
    hashers = {}
    stats = {"r1": MateStats(), "r2": MateStats()}
    first: IlluminaName | None = None
    barcode: str | None = None
    lanes: set[int] = set()
    with r1.open("rb") as r1_handle, r2.open("rb") as r2_handle:
        hashers = {"r1": HashingReader(r1_handle), "r2": HashingReader(r2_handle)}
        mates = {
            mate: read_records(open_lines(path, hashers[mate]))
            for mate, path in (("r1", r1), ("r2", r2))
        }
        number = 0
        while True:
            number += 1
            record_r1 = next(mates["r1"], None)
            record_r2 = next(mates["r2"], None)
            if record_r1 is None and record_r2 is None:
                break
            if isinstance(record_r1, str) or isinstance(record_r2, str):
                for mate, record in (("R1", record_r1), ("R2", record_r2)):
                    if isinstance(record, str):
                        validation.error(f"{mate}: {record}")
                break
            if record_r1 is None or record_r2 is None:
                longer = "R1" if record_r2 is None else "R2"
                validation.error(f"{longer} has more records than its mate (from record {number})")
                break
            valid = check_record(record_r1, "R1", number, validation)
            valid = check_record(record_r2, "R2", number, validation) and valid
            if not valid:
                continue
            stats["r1"].add(len(record_r1[1]))
            stats["r2"].add(len(record_r2[1]))
            name_r1, comment = parse_illumina_header(record_r1[0])
            name_r2, _ = parse_illumina_header(record_r2[0])
            if name_r1 is None or name_r2 is None:
                validation.error(
                    f"record {number}: not an Illumina read name "
                    "(<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>)"
                )
                continue
            if name_r1.read_name != name_r2.read_name:
                validation.error(
                    f"record {number}: mates are named differently ({name_r1.read_name} and {name_r2.read_name})"
                )
                continue
            if first is None:
                first = name_r1
                barcode = barcode_from_comment(comment)
            elif (name_r1.instrument, name_r1.run, name_r1.flowcell) != (first.instrument, first.run, first.flowcell):
                validation.error(
                    f"record {number}: instrument, run, or flowcell differs from the first record "
                    f"({name_r1.instrument}:{name_r1.run}:{name_r1.flowcell}, first "
                    f"{first.instrument}:{first.run}:{first.flowcell})"
                )
                continue
            lanes.add(name_r1.lane)
    if stats["r1"].records == 0 and not validation.errors:
        validation.error("the read pair holds no records")
    if barcode is not None and not READ_GROUP_VALUE.match(barcode):
        validation.error(f"the first record's barcode {barcode!r} cannot be used in a read group")

    read_group = None
    if not validation.errors and first is not None:
        lane_suffix = f".{next(iter(lanes))}" if len(lanes) == 1 else ""
        barcode_suffix = f".{barcode}" if barcode else ""
        platform_unit = f"{first.flowcell}{lane_suffix}{barcode_suffix}"
        sample_name, library_source = library_sample_name(r1, isolate_id)
        read_group = {
            "id": platform_unit,
            "pu": platform_unit,
            "sm": isolate_id,
            "lb": f"{sample_name}{barcode_suffix}",
            "pl": "ILLUMINA",
            "library_source": library_source,
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "status": "failed" if validation.errors else "passed",
        "isolate_id": isolate_id,
        "pair": pair,
        "trimmed": trimmed,
        "files": {
            mate: {"path": str(path), "sha256": hashers[mate].digest.hexdigest(), "bytes": hashers[mate].size}
            for mate, path in (("r1", r1), ("r2", r2))
        },
        "reads": {mate: mate_stats.to_json() for mate, mate_stats in stats.items()},
        "sequencing": None
        if first is None
        else {
            "instrument": first.instrument,
            "run": first.run,
            "flowcell": first.flowcell,
            "lanes": sorted(lanes),
            "barcode": barcode,
        },
        "read_group": read_group,
        "errors": validation.errors,
        "suppressed_errors": validation.suppressed_errors,
    }


def read_group_line(read_group: dict) -> str:
    fields = [f"ID:{read_group['id']}", f"PU:{read_group['pu']}", f"SM:{read_group['sm']}",
              f"LB:{read_group['lb']}", f"PL:{read_group['pl']}"]
    return "\\t".join(["@RG", *fields])


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--isolate-id", required=True)
    parser.add_argument("--pair", type=int, required=True)
    parser.add_argument("--r1", type=Path, required=True)
    parser.add_argument("--r2", type=Path, required=True)
    parser.add_argument("--trimmed", choices=("trimmed", "untrimmed"), required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--read-group", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    report = validate(args.isolate_id, args.pair, args.r1, args.r2, args.trimmed == "trimmed")
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
