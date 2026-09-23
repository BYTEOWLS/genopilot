#!/usr/bin/env python3
"""Validate resolved FASTA/GFF3 inputs before any scientific rule runs.

Checks FASTA structure, GFF3 structure and ID/Parent relationships, and the
cross-references between the reference GFF3 and reference FASTA. Emits the
`input-validation` artifact (see manifest.yaml). Kept dependency-free
(standard library only) since these are structural checks, not sequence
analysis. See AGENTS.md "Scientific and reproducibility guidelines": validate
inputs before dependent stages run.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
_HEADER_ID_PATTERN = re.compile(r"^>(\S+)")
_SEQUENCE_CHARACTERS = re.compile(r"^[ACGTUNRYSWKMBDHV.-]*$", re.IGNORECASE)
_STRANDS = {"+", "-", ".", "?"}
_GFF3_COLUMNS = (
    "seqid",
    "source",
    "type",
    "start",
    "end",
    "score",
    "strand",
    "phase",
    "attributes",
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


@dataclass
class FastaResult:
    sequence_ids: list[str] = field(default_factory=list)
    sequence_lengths: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse_fasta(path: Path) -> FastaResult:
    result = FastaResult()
    seen: set[str] = set()
    current_id: str | None = None
    current_length = 0
    has_records = False

    with open(path, encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\n")
            if line.startswith(">"):
                if current_id is not None:
                    if current_length == 0:
                        result.errors.append(f"sequence '{current_id}' has no sequence data")
                    result.sequence_lengths[current_id] = current_length
                match = _HEADER_ID_PATTERN.match(line)
                if not match:
                    result.errors.append(f"line {line_number}: header has no identifier")
                    current_id = None
                    continue
                current_id = match.group(1)
                has_records = True
                if current_id in seen:
                    result.errors.append(f"duplicate sequence id '{current_id}'")
                seen.add(current_id)
                result.sequence_ids.append(current_id)
                current_length = 0
            elif line.strip() == "":
                continue
            else:
                if current_id is None:
                    result.errors.append(f"line {line_number}: sequence data before any header")
                    continue
                if not _SEQUENCE_CHARACTERS.match(line):
                    result.errors.append(
                        f"sequence '{current_id}': line {line_number} has non-IUPAC characters"
                    )
                current_length += len(line.strip())

    if current_id is not None:
        if current_length == 0:
            result.errors.append(f"sequence '{current_id}' has no sequence data")
        result.sequence_lengths[current_id] = current_length
    if not has_records:
        result.errors.append("file contains no FASTA records")
    return result


@dataclass
class Gff3Result:
    feature_count: int = 0
    feature_types: dict[str, int] = field(default_factory=dict)
    seqids: set[str] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _parse_attributes(raw: str) -> dict[str, str]:
    attributes: dict[str, str] = {}
    for entry in raw.split(";"):
        entry = entry.strip()
        if not entry:
            continue
        if "=" not in entry:
            continue
        key, _, value = entry.partition("=")
        attributes[key.strip()] = value.strip()
    return attributes


def parse_gff3(path: Path) -> Gff3Result:
    result = Gff3Result()
    has_version_pragma = False
    ids_seen: dict[str, int] = {}
    parent_refs: list[tuple[int, str]] = []

    with open(path, encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\n")
            if line_number == 1 and line.startswith("##gff-version"):
                has_version_pragma = True
                continue
            if line.startswith("#") or line.strip() == "":
                continue

            columns = line.split("\t")
            if len(columns) != 9:
                result.errors.append(
                    f"line {line_number}: expected 9 tab-separated columns, found {len(columns)}"
                )
                continue
            seqid, _source, feature_type, start, end, _score, strand, phase, attributes_raw = (
                columns
            )

            result.feature_count += 1
            result.feature_types[feature_type] = result.feature_types.get(feature_type, 0) + 1
            result.seqids.add(seqid)

            try:
                start_value = int(start)
                end_value = int(end)
                if start_value < 1 or end_value < start_value:
                    result.errors.append(
                        f"line {line_number}: coordinates '{start}-{end}' are not a valid 1-based range"
                    )
            except ValueError:
                result.errors.append(f"line {line_number}: start/end must be integers")

            if strand not in _STRANDS:
                result.errors.append(f"line {line_number}: strand '{strand}' is not one of +/-/./?")

            if feature_type == "CDS":
                if phase not in {"0", "1", "2"}:
                    result.errors.append(f"line {line_number}: CDS phase must be 0, 1, or 2")
            elif phase != ".":
                result.warnings.append(
                    f"line {line_number}: phase should be '.' for non-CDS feature '{feature_type}'"
                )

            attributes = _parse_attributes(attributes_raw)
            feature_id = attributes.get("ID")
            if feature_id:
                ids_seen[feature_id] = ids_seen.get(feature_id, 0) + 1
            elif feature_type not in {"exon"}:
                result.warnings.append(f"line {line_number}: feature has no ID attribute")

            for parent in attributes.get("Parent", "").split(","):
                parent = parent.strip()
                if parent:
                    parent_refs.append((line_number, parent))

    if not has_version_pragma:
        result.errors.append("missing required '##gff-version 3' pragma on the first line")

    # A shared ID across multiple lines is valid GFF3 for a single multi-exon
    # CDS/multi-part feature; only flag an ID that also collides with a
    # distinct feature type is left for downstream semantic validation.
    for feature_id, count in ids_seen.items():
        if count > 1:
            result.warnings.append(
                f"ID '{feature_id}' is used by {count} feature lines (valid for a shared multi-part feature)"
            )

    known_ids = set(ids_seen)
    for line_number, parent in parent_refs:
        if parent not in known_ids:
            result.errors.append(f"line {line_number}: Parent '{parent}' has no matching ID")

    return result


def cross_check(reference_fasta: FastaResult, reference_gff3: Gff3Result) -> list[str]:
    errors: list[str] = []
    fasta_ids = set(reference_fasta.sequence_ids)
    for seqid in sorted(reference_gff3.seqids):
        if seqid not in fasta_ids:
            errors.append(f"GFF3 seqid '{seqid}' is not present in the reference FASTA")
    return errors


def build_summary(
    reference_fasta_path: Path,
    reference_fasta: FastaResult,
    reference_gff3_path: Path,
    reference_gff3: Gff3Result,
    target_fasta_path: Path,
    target_fasta: FastaResult,
    cross_check_errors: list[str],
) -> dict:
    passed = (
        not reference_fasta.errors
        and not reference_gff3.errors
        and not target_fasta.errors
        and not cross_check_errors
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "status": "passed" if passed else "failed",
        "reference_fasta": {
            "path": str(reference_fasta_path),
            "sequence_count": len(reference_fasta.sequence_ids),
            "sequence_lengths": reference_fasta.sequence_lengths,
            "errors": reference_fasta.errors,
            "warnings": reference_fasta.warnings,
        },
        "reference_gff3": {
            "path": str(reference_gff3_path),
            "feature_count": reference_gff3.feature_count,
            "feature_types": reference_gff3.feature_types,
            "errors": reference_gff3.errors,
            "warnings": reference_gff3.warnings,
        },
        "target_fasta": {
            "path": str(target_fasta_path),
            "sequence_count": len(target_fasta.sequence_ids),
            "sequence_lengths": target_fasta.sequence_lengths,
            "errors": target_fasta.errors,
            "warnings": target_fasta.warnings,
        },
        "cross_checks": {
            "errors": cross_check_errors,
        },
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-fasta", type=Path, required=True)
    parser.add_argument("--reference-gff3", type=Path, required=True)
    parser.add_argument("--target-fasta", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    reference_fasta = parse_fasta(args.reference_fasta)
    reference_gff3 = parse_gff3(args.reference_gff3)
    target_fasta = parse_fasta(args.target_fasta)
    cross_check_errors = cross_check(reference_fasta, reference_gff3)

    summary = build_summary(
        args.reference_fasta,
        reference_fasta,
        args.reference_gff3,
        reference_gff3,
        args.target_fasta,
        target_fasta,
        cross_check_errors,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    # Always succeeds: a "failed" status is carried in the report itself so
    # Snakemake preserves it as diagnostic evidence instead of deleting the
    # output of a failed job. A later stage gates on this report's status
    # before LiftOn runs, rather than this script failing the job directly.
    return 0


if __name__ == "__main__":
    sys.exit(main())
