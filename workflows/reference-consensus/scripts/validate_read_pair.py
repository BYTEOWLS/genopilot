#!/usr/bin/env python3
"""Derive one read pair's read group from its Illumina read names, and checksum it.

Only what the pipeline's tools do not check themselves happens here:

  - every read name must be an Illumina read name
    (`<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>`) agreeing with the
    first one on instrument, run, and flowcell; lanes may differ, because a
    lane-merged delivery combines every lane of a flowcell in one file;
  - R1 and R2 must hold the same number of records, which bwa does not
    verify;
  - the SHA-256 of both files as delivered is recorded for provenance.

The record format (four lines, qualities as long as the bases) is checked by
fastp, and matching mate names by bwa mem; both fail their job on an error.
Read lengths and counts are reported by fastp.

The read group:

  PU = ID  <flowcell>[.<lane>].<barcode>; the lane only when every record
           has the same one, the barcode from the first record's comment
  SM       the isolate ID
  LB       the Illumina sample name from the R1 file name
           (`<sample>_S<n>[_L<lane>]_R1_<chunk>.fastq.gz`), or the isolate ID
           when the file name does not follow that pattern, plus the barcode
  PL       ILLUMINA

Writes the report (JSON) and, only when the pair passed, the read group as
one `@RG` line with literal `\\t` separators, ready for `bwa mem -R`. A failed
check also prints the report and exits non-zero, because Snakemake removes
the outputs of a failed job and keeps only its log.

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
from datetime import datetime, timezone
from itertools import islice
from pathlib import Path
from typing import BinaryIO, Iterator

SCHEMA_VERSION = 1
MAX_REPORTED_ERRORS = 20
ILLUMINA_FILE_NAME = re.compile(r"^(.+)_S(\d+)(?:_L(\d{3}))?_R1_(\d{3})\.fastq\.gz$")
READ_GROUP_VALUE = re.compile(r"^[A-Za-z0-9._+-]+$")


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


def headers(hasher: HashingReader) -> Iterator[str]:
    """Yields the header line of every record of a plain or gzip FASTQ file."""
    raw = io.BufferedReader(hasher)
    stream: BinaryIO = gzip.GzipFile(fileobj=raw) if raw.peek(2)[:2] == b"\x1f\x8b" else raw
    lines = io.TextIOWrapper(stream, encoding="ascii", errors="replace", newline=None)
    # Reading every header reads the whole file, so the checksum covers all of it.
    yield from islice(lines, 0, None, 4)


def parse_illumina_name(header: str) -> dict | None:
    """Parses `@<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>` from a header line."""
    name = header[1:].split(maxsplit=1)[0] if header.startswith("@") and len(header) > 1 else ""
    fields = name.removesuffix("/1").removesuffix("/2").split(":")
    if len(fields) != 7:
        return None
    instrument, run, flowcell, lane, *position = fields
    if not instrument or not flowcell or not all(value.isdigit() for value in (run, lane, *position)):
        return None
    return {"instrument": instrument, "run": int(run), "flowcell": flowcell, "lane": int(lane)}


def barcode_from_header(header: str) -> str | None:
    """Returns the index field of an Illumina comment (`<read>:<filtered>:<control>:<index>`)."""
    parts = header.split(maxsplit=1)
    fields = parts[1].split()[0].split(":") if len(parts) > 1 else []
    return fields[3] if len(fields) == 4 and fields[3] else None


def library_sample_name(r1_path: Path, isolate_id: str) -> tuple[str, str]:
    match = ILLUMINA_FILE_NAME.match(r1_path.name)
    if match and READ_GROUP_VALUE.match(match.group(1)):
        return match.group(1), "illumina-file-name"
    return isolate_id, "isolate-id"


def check(r1: Path, r2: Path) -> tuple[dict, dict | None, str | None, set[int], list[str]]:
    """Returns the file checksums, the first read's fields, its barcode, the lanes, and the errors."""
    errors: list[str] = []
    first: dict | None = None
    barcode: str | None = None
    lanes: set[int] = set()
    counts = {"r1": 0, "r2": 0}
    with r1.open("rb") as r1_handle, r2.open("rb") as r2_handle:
        hashers = {"r1": HashingReader(r1_handle), "r2": HashingReader(r2_handle)}
        for header in headers(hashers["r1"]):
            counts["r1"] += 1
            fields = parse_illumina_name(header)
            if fields is None:
                errors.append(
                    f"R1 record {counts['r1']}: not an Illumina read name "
                    "(<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>)"
                )
            elif first is None:
                first, barcode = fields, barcode_from_header(header)
            elif (fields["instrument"], fields["run"], fields["flowcell"]) != (
                first["instrument"], first["run"], first["flowcell"]
            ):
                errors.append(
                    f"R1 record {counts['r1']}: instrument, run, or flowcell differs from the first record "
                    f"({fields['instrument']}:{fields['run']}:{fields['flowcell']}, first "
                    f"{first['instrument']}:{first['run']}:{first['flowcell']})"
                )
            if fields is not None:
                lanes.add(fields["lane"])
            if len(errors) >= MAX_REPORTED_ERRORS:
                break
        counts["r2"] = sum(1 for _ in headers(hashers["r2"]))
        if not errors:
            if counts["r1"] == 0:
                errors.append("the read pair holds no records")
            elif counts["r1"] != counts["r2"]:
                errors.append(f"R1 holds {counts['r1']} records but R2 holds {counts['r2']}")
        if barcode is not None and not READ_GROUP_VALUE.match(barcode):
            errors.append(f"the first record's barcode {barcode!r} cannot be used in a read group")
        files = {
            mate: {"path": str(path), "sha256": hashers[mate].digest.hexdigest(), "bytes": hashers[mate].size}
            for mate, path in (("r1", r1), ("r2", r2))
        }
    return files, first, barcode, lanes, errors


def validate(isolate_id: str, pair: int, r1: Path, r2: Path, trimmed: bool) -> dict:
    files, first, barcode, lanes, errors = check(r1, r2)
    read_group = None
    if not errors and first is not None:
        lane_suffix = f".{next(iter(lanes))}" if len(lanes) == 1 else ""
        barcode_suffix = f".{barcode}" if barcode else ""
        platform_unit = f"{first['flowcell']}{lane_suffix}{barcode_suffix}"
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
        "status": "failed" if errors else "passed",
        "isolate_id": isolate_id,
        "pair": pair,
        "trimmed": trimmed,
        "files": files,
        "sequencing": None if first is None else {**first, "lanes": sorted(lanes), "barcode": barcode},
        "read_group": read_group,
        "errors": errors,
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
