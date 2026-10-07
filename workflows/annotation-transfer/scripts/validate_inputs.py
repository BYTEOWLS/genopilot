#!/usr/bin/env python3
"""Validate resolved FASTA/GFF3 inputs before any scientific rule runs.

Checks FASTA structure, GFF3 structure and ID/Parent relationships, and the
cross-references between the reference GFF3 and reference FASTA. Emits the
annotation-transfer `input-validation` artifact (see its manifest.yaml).
The FASTA parser is the shared one in workflows/shared/scripts/fasta.py.

Kept dependency-free (standard library only) since these are structural
checks, not sequence analysis. See AGENTS.md "Scientific and reproducibility
guidelines": validate inputs before dependent stages run.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))

from fasta import FastaCheck, check_fasta  # noqa: E402
from provenance import utc_now_iso, write_json  # noqa: E402

SCHEMA_VERSION = 1
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


@dataclass
class Gff3Check:
    """What `check_gff3` found in one GFF3 file.

    Attributes:
        feature_count: The feature lines with nine columns.
        feature_types: How many of those lines have each type in column 3, such as gene or CDS.
        seqids: The sequence identifiers the features lie on, from column 1.
        errors: Structural problems that make the file unusable; empty when it passed.
        warnings: Deviations from GFF3 conventions that do not block a run.
    """

    feature_count: int = 0
    feature_types: dict[str, int] = field(default_factory=dict)
    seqids: set[str] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _parse_gff3_attributes(raw: str) -> dict[str, str]:
    """The `key=value` pairs of a GFF3 attributes column; entries without `=` are skipped, and a
    repeated key keeps its last value. Values stay as written, such as `Parent=a,b`."""
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


def check_gff3(path: Path) -> Gff3Check:
    """Check the structure and feature hierarchy of a GFF3 file.

    Reads the whole file and collects every problem instead of stopping at the first, so a
    validation report can list them all. Used for the reference annotation before LiftOn
    and, by validate_annotation.py, for LiftOn's result. `read_gff3_features` in
    collect_transfer_metrics.py reads features for the metrics instead.

    Args:
        path: The GFF3 file, UTF-8 encoded.

    Returns:
        The feature counts and sequence identifiers, with an error for a missing
        `##gff-version` pragma on the first line, a line without nine tab-separated columns,
        start or end coordinates that are not integers or not a 1-based range, an unknown
        strand, a CDS phase other than 0, 1, or 2, or a `Parent` without a matching `ID`; and
        a warning for a phase on a feature other than a CDS, a feature other than an exon
        without an `ID`, or an `ID` shared by several lines, which is valid for a multi-part
        feature.
    """
    result = Gff3Check()
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

            attributes = _parse_gff3_attributes(attributes_raw)
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


def cross_check(reference_fasta: FastaCheck, reference_gff3: Gff3Check) -> list[str]:
    errors: list[str] = []
    fasta_ids = set(reference_fasta.sequence_ids)
    for seqid in sorted(reference_gff3.seqids):
        if seqid not in fasta_ids:
            errors.append(f"GFF3 seqid '{seqid}' is not present in the reference FASTA")
    return errors


def warn_about_unresolved_target_bases(target_fasta: FastaCheck) -> None:
    """A codon with such a base cannot be translated, so it changes the protein comparison of the
    gene it lies in without any real change in the target."""
    counts = target_fasta.unresolved_bases
    if counts["n"] or counts["iupac"]:
        target_fasta.warnings.append(
            f"the target has {counts['n']} bases written as N and {counts['iupac']} other bases "
            "that are not A, C, G, or T; genes containing them are marked for review"
        )


def build_summary(
    reference_fasta_path: Path,
    reference_fasta: FastaCheck,
    reference_gff3_path: Path,
    reference_gff3: Gff3Check,
    target_fasta_path: Path,
    target_fasta: FastaCheck,
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
            "unresolved_bases": reference_fasta.unresolved_bases,
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
            "unresolved_bases": target_fasta.unresolved_bases,
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

    reference_fasta = check_fasta(args.reference_fasta)
    reference_gff3 = check_gff3(args.reference_gff3)
    target_fasta = check_fasta(args.target_fasta)
    warn_about_unresolved_target_bases(target_fasta)
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
    write_json(args.output, summary)
    # Always succeeds: a "failed" status is carried in the report itself so
    # Snakemake preserves it as diagnostic evidence instead of deleting the
    # output of a failed job. transfer_annotation checks this report's status
    # (require_passed_validation.py) and refuses to start LiftOn unless it passed.
    return 0


if __name__ == "__main__":
    sys.exit(main())
