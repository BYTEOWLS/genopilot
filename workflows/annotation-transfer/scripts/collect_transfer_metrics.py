#!/usr/bin/env python3
"""Collect auditable LiftOn transfer metrics and a completion summary.

LiftOn's structured reports are authoritative for transfer counts and mapping
status. The raw LiftOn GFF3 supplies coordinates and model-level attributes
such as identity and mutation classifications, and is cross-checked against
those reports rather than used to replace them. Human-readable LiftOn or
Snakemake console output is never parsed.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))

from provenance import utc_now_iso, write_json  # noqa: E402

METRICS_SCHEMA_VERSION = 1
SUMMARY_SCHEMA_VERSION = 1
DETAIL_COLUMNS = (
    "reference_id",
    "feature_type",
    "reference_seqid",
    "reference_start",
    "reference_end",
    "reference_strand",
    "lifton_category",
    "status",
    "copy_number",
    "target_id",
    "target_seqid",
    "target_start",
    "target_end",
    "target_strand",
    "transfer_method",
    "minimum_dna_identity",
    "minimum_protein_identity",
    "mutations",
    "protein_category",
    "lifton_status",
    "unresolved_bases",
    "review_reasons",
)

# LiftOn mutation classes that describe no protein-level change.
UNCHANGED_PROTEIN_CLASSES = frozenset({"identical", "synonymous", "non_coding"})

# Protein categories of a coding gene's primary copy from its mutation classes, most severe first.
# LiftOn writes no class at all for an identical protein, which therefore counts as unchanged.
CATEGORY_CLASSES = (
    ("lost", frozenset({"full_transcript_loss", "no_protein"})),
    ("disrupted", frozenset({"frameshift", "stop_codon_gain", "stop_missing", "start_lost"})),
    ("inframe_indel", frozenset({"inframe_insertion", "inframe_deletion"})),
    ("substitutions", frozenset({"nonsynonymous"})),
    ("unchanged", UNCHANGED_PROTEIN_CLASSES),
)
PROTEIN_CATEGORIES = ("unmapped", *(category for category, _classes in CATEGORY_CLASSES))
KNOWN_MUTATION_CLASSES = frozenset().union(*(classes for _category, classes in CATEGORY_CLASSES))
REVIEW_REASONS = ("unmapped_or_lost", "disrupted", "below_threshold", "unresolved_bases")
_UNRESOLVED_RUN = re.compile(r"[^ACGTacgt]+")

METRIC_EXPLANATIONS = {
    "reference_features": "Count of top-level reference features that LiftOn selected for transfer.",
    "mapped_features": "Count of selected reference features that LiftOn placed at least once on the target assembly.",
    "unmapped_features": "Count of selected reference features that LiftOn did not place on the target assembly.",
    "mapping_fraction": "Mapped reference features divided by selected reference features.",
    "target_feature_copies": "Count of target copies emitted by LiftOn: one primary copy per mapped reference feature plus all additional copies.",
    "features_with_extra_copies": "Count of reference features for which LiftOn emitted at least one additional target copy.",
    "extra_copies": "Count of additional target copies beyond the primary copy, summed over all reference features.",
    "miniprot_rescues": "Count of genes added by LiftOn's separate miniprot rescue pass after the Liftoff and regular miniprot steps; a gene it places at a second locus is an additional copy and is not counted here.",
    "transfer_methods_by_target_copy": "Count of target copies per LiftOn transfer method.",
    "changed_primary_protein_coding_features": "Count of mapped protein-coding reference features whose primary target copy carries a mutation class other than identical or synonymous.",
    "mutation_classifications_by_target_copy": "Count of target copies carrying each LiftOn mutation class; one copy can carry several classes.",
    "dna_identity_by_transcript_model": "Minimum, mean, and maximum LiftOn dna_identity over transcript models: aligned transcript sequence identity between reference and target.",
    "protein_identity_by_transcript_model": "Minimum, mean, and maximum LiftOn protein_identity over transcript models: aligned protein sequence identity between reference and target.",
    "minimum_protein_identity_percent": "Run parameter: a rated gene whose lowest protein identity lies below this percentage is listed for review.",
    "rated_genes": "Count of coding reference features rated: each primary target copy and each unmapped feature.",
    "genes_by_category": "Count of rated genes per protein category; see the protein_category column.",
    "genes_by_review_reason": "Count of rated genes per review reason; one gene can have several reasons.",
    "genes_listed_for_review": "Count of rated genes with at least one review reason.",
    "genes_by_match": "Rated genes split into three disjoint groups: exact_match (not listed for review, protein unchanged), near_match (not listed for review, protein changed but its identity at or above the minimum protein identity), and needs_review (listed for review).",
    "unresolved_target_bases": "Count of target bases that are not A, C, G, or T, listed as intervals in the unresolved-bases BED: n for N, other for every other code, such as an IUPAC ambiguity code or a gap character.",
}

DETAIL_EXPLANATIONS = {
    "reference_id": "Identifier of the selected top-level feature in the reference GFF3 file.",
    "feature_type": "GFF3 type of the reference feature, for example gene.",
    "reference_seqid": "Reference sequence carrying the feature, in the reference genome's coordinates.",
    "reference_start": "One-based start coordinate of the feature on the reference sequence.",
    "reference_end": "One-based inclusive end coordinate of the feature on the reference sequence.",
    "reference_strand": "Strand of the feature on the reference sequence.",
    "lifton_category": "LiftOn category of the reference feature: coding, non-coding, or other.",
    "status": "mapped for the primary target copy, extra-copy for an additional target copy, or unmapped.",
    "copy_number": "Zero for the primary target copy; positive values identify additional LiftOn copies.",
    "target_id": "Target identifier assigned by LiftOn.",
    "target_seqid": "Target assembly sequence carrying this copy.",
    "target_start": "One-based start coordinate of this copy on the target sequence.",
    "target_end": "One-based inclusive end coordinate of this copy on the target sequence.",
    "target_strand": "Strand of this copy on the target sequence.",
    "transfer_method": "LiftOn transfer method recorded for this copy, such as Liftoff or miniprot.",
    "minimum_dna_identity": "Lowest LiftOn DNA identity among transcript models below this target copy.",
    "minimum_protein_identity": "Lowest LiftOn protein identity among transcript models below this target copy.",
    "mutations": "Distinct LiftOn mutation classes observed below this target copy.",
    "protein_category": "Most severe protein change of a coding feature's primary copy: unmapped, lost, disrupted, inframe_indel, substitutions, or unchanged; empty on additional copies and non-coding features.",
    "lifton_status": "LiftOn's transcript statuses below this target copy, which say how LiftOn built each model, such as Liftoff, LiftOn_chaining_algorithm, or miniprot; empty where no rating applies.",
    "unresolved_bases": "Count of target bases that are not A, C, G, or T in the union of this copy's CDS, each position once; empty where no rating applies.",
    "review_reasons": "Reasons this gene is listed for review: unmapped_or_lost, disrupted, below_threshold, unresolved_bases; empty when none.",
}


class SummaryError(ValueError):
    """Raised when persisted LiftOn evidence is missing or contradictory."""


def parse_gff3_attributes(raw: str) -> dict[str, str]:
    """The `key=value` pairs of a GFF3 attributes column; entries without `=` are skipped, and a
    repeated key keeps its last value. Values stay as written, such as `Parent=a,b`."""
    attributes: dict[str, str] = {}
    for entry in raw.split(";"):
        if not entry or "=" not in entry:
            continue
        key, _, value = entry.partition("=")
        attributes[key.strip()] = value.strip()
    return attributes


@dataclass(frozen=True)
class Feature:
    seqid: str
    source: str
    feature_type: str
    start: int
    end: int
    strand: str
    attributes: dict[str, str]

    @property
    def feature_id(self) -> str | None:
        return self.attributes.get("ID")

    @property
    def parents(self) -> tuple[str, ...]:
        return tuple(value for value in self.attributes.get("Parent", "").split(",") if value)


@dataclass(frozen=True)
class ReportedFeature:
    copies: int
    category: str


@dataclass(frozen=True)
class CompletenessRow:
    feature_type: str
    reference: int
    lifted: int
    missed: int
    features_with_extra_copies: int
    target: int


def read_gff3_features(path: Path) -> list[Feature]:
    """Read every feature of a GFF3 file that `check_gff3` has already checked.

    Comment, pragma, and blank lines are skipped. Unlike `check_gff3` in validate_inputs.py,
    nothing else is checked, and the first malformed line ends the reading. The metrics also
    run when that check failed, so such a line can still reach this function.

    Args:
        path: The GFF3 file, UTF-8 encoded.

    Returns:
        The features in file order.

    Raises:
        SummaryError: A line does not have nine tab-separated columns, or its start or end
            is not an integer.
    """
    features: list[Feature] = []
    with open(path, encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            columns = line.split("\t")
            if len(columns) != 9:
                raise SummaryError(f"{path}: line {line_number} does not have 9 GFF3 columns")
            try:
                start = int(columns[3])
                end = int(columns[4])
            except ValueError as error:
                raise SummaryError(
                    f"{path}: line {line_number} has non-integer coordinates"
                ) from error
            features.append(
                Feature(
                    seqid=columns[0],
                    source=columns[1],
                    feature_type=columns[2],
                    start=start,
                    end=end,
                    strand=columns[6],
                    attributes=parse_gff3_attributes(columns[8]),
                )
            )
    return features


def top_level_features(
    features: list[Feature], path: Path, selected_types: set[str]
) -> list[Feature]:
    """Returns one record per selected top-level ID, spanning discontinuous parts."""
    grouped: dict[str, list[Feature]] = {}
    for feature in features:
        feature_id = feature.feature_id
        if feature.parents or feature_id is None or feature.feature_type not in selected_types:
            continue
        grouped.setdefault(feature_id, []).append(feature)

    top_level: list[Feature] = []
    for feature_id, parts in grouped.items():
        first = parts[0]
        for part in parts[1:]:
            if (
                part.seqid != first.seqid
                or part.feature_type != first.feature_type
                or part.strand != first.strand
            ):
                raise SummaryError(
                    f"{path}: discontinuous top-level ID '{feature_id}' has inconsistent records"
                )
            for attribute in ("extra_copy_number", "source"):
                if part.attributes.get(attribute) != first.attributes.get(attribute):
                    raise SummaryError(
                        f"{path}: discontinuous top-level ID '{feature_id}' has inconsistent '{attribute}'"
                    )
        top_level.append(
            Feature(
                seqid=first.seqid,
                source=first.source,
                feature_type=first.feature_type,
                start=min(part.start for part in parts),
                end=max(part.end for part in parts),
                strand=first.strand,
                attributes=first.attributes,
            )
        )
    return top_level


def descendant_records(features: list[Feature]) -> dict[str, list[Feature]]:
    children: dict[str, set[str]] = defaultdict(set)
    records_by_id: dict[str, list[Feature]] = defaultdict(list)
    for feature in features:
        if feature.feature_id:
            records_by_id[feature.feature_id].append(feature)
            for parent in feature.parents:
                children[parent].add(feature.feature_id)

    descendants: dict[str, list[Feature]] = {}
    for root in records_by_id:
        found_ids: set[str] = set()
        pending = list(children.get(root, set()))
        while pending:
            child = pending.pop()
            if child in found_ids:
                continue
            found_ids.add(child)
            pending.extend(children.get(child, set()))
        descendants[root] = [record for child in found_ids for record in records_by_id[child]]
    return descendants


def read_required_lines(path: Path) -> list[str]:
    if not path.is_file():
        raise SummaryError(f"required LiftOn result is missing: {path}")
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_selected_feature_types(path: Path) -> set[str]:
    selected = {
        line.strip()
        for line in read_required_lines(path)
        if not line.lstrip().startswith("#")
    }
    if not selected:
        raise SummaryError(f"{path} contains no selected feature types")
    return selected


def parse_reported_features(path: Path, mapped: bool) -> dict[str, ReportedFeature]:
    reported: dict[str, ReportedFeature] = {}
    expected_columns = 3 if mapped else 2
    for line_number, line in enumerate(read_required_lines(path), start=1):
        columns = line.split("\t")
        if len(columns) != expected_columns:
            raise SummaryError(
                f"{path}: line {line_number} has {len(columns)} columns; expected {expected_columns}"
            )
        feature_id = columns[0]
        if feature_id in reported:
            raise SummaryError(f"{path}: duplicate feature ID '{feature_id}'")
        if mapped:
            try:
                copies = int(columns[1])
            except ValueError as error:
                raise SummaryError(
                    f"{path}: line {line_number} has invalid copy count '{columns[1]}'"
                ) from error
            if copies < 1:
                raise SummaryError(f"{path}: feature '{feature_id}' has fewer than one copy")
            category = columns[2]
        else:
            copies = 0
            category = columns[1]
        reported[feature_id] = ReportedFeature(copies=copies, category=category)
    return reported


def parse_completeness(path: Path) -> dict[str, CompletenessRow]:
    lines = read_required_lines(path)
    expected_header = (
        "feature_type\tn_reference\tn_lifted\tn_missed\tn_extra_copies\tn_target\tpct_recovered"
    )
    if lines[0] != expected_header:
        raise SummaryError(f"{path}: unsupported header '{lines[0]}'")

    rows: dict[str, CompletenessRow] = {}
    for line_number, line in enumerate(lines[1:], start=2):
        columns = line.split("\t")
        if len(columns) != 7:
            raise SummaryError(f"{path}: line {line_number} does not have 7 columns")
        feature_type = columns[0]
        if feature_type in rows:
            raise SummaryError(f"{path}: duplicate feature type '{feature_type}'")
        try:
            counts = [int(value) for value in columns[1:6]]
            float(columns[6])
        except ValueError as error:
            raise SummaryError(f"{path}: line {line_number} has an invalid numeric value") from error
        rows[feature_type] = CompletenessRow(feature_type, *counts)
    if not rows:
        raise SummaryError(f"{path} contains no completeness rows")
    return rows


def read_json(path: Path) -> dict:
    if not path.is_file():
        raise SummaryError(f"required JSON result is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SummaryError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise SummaryError(f"{path} must contain a JSON object")
    return value


def required_integer(record: dict, field: str, path: Path) -> int:
    value = record.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise SummaryError(f"{path}: required integer count '{field}' is unavailable")
    return value


def parse_run_manifest(path: Path) -> tuple[dict, dict[str, int]]:
    manifest = read_json(path)
    counts = manifest.get("counts")
    if not isinstance(counts, dict):
        raise SummaryError(f"{path} has no object-valued 'counts' field")
    required = {
        field: required_integer(counts, field, path)
        for field in (
            "reference_features",
            "mapped_reference_features",
            "emitted_feature_copies",
            "miniprot_rescued_genes",
        )
    }
    return manifest, required


def optional_float(value: str | None, field: str, feature_id: str) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError as error:
        raise SummaryError(f"feature '{feature_id}' has invalid {field} value '{value}'") from error


def copy_number_and_reference_id(
    target: Feature, reference_ids: set[str]
) -> tuple[int, str]:
    target_id = target.feature_id
    assert target_id is not None
    raw_copy_number = target.attributes.get("extra_copy_number")
    if raw_copy_number is None:
        if target_id not in reference_ids:
            raise SummaryError(
                f"target top-level feature '{target_id}' has no matching reference ID"
            )
        return 0, target_id

    try:
        copy_number = int(raw_copy_number)
    except ValueError as error:
        raise SummaryError(
            f"target feature '{target_id}' has invalid extra_copy_number '{raw_copy_number}'"
        ) from error
    if copy_number < 1:
        raise SummaryError(f"target feature '{target_id}' has non-positive extra_copy_number")

    suffix = f"_{copy_number}"
    if not target_id.endswith(suffix):
        raise SummaryError(
            f"extra-copy target ID '{target_id}' does not end with expected suffix '{suffix}'"
        )
    reference_id = target_id[: -len(suffix)]
    if reference_id not in reference_ids:
        raise SummaryError(
            f"extra-copy target '{target_id}' has no matching reference ID '{reference_id}'"
        )
    return copy_number, reference_id


def minimum_identity(records: list[Feature], attribute: str) -> float | None:
    values = [
        value
        for record in records
        if (value := optional_float(record.attributes.get(attribute), attribute, record.feature_id or ""))
        is not None
    ]
    return min(values) if values else None


def mutation_classes(records: list[Feature]) -> list[str]:
    mutations: set[str] = set()
    for record in records:
        for mutation in record.attributes.get("mutation", "").split(","):
            if mutation:
                mutations.add(mutation)
    return sorted(mutations)


def transfer_method(feature: Feature, records: list[Feature]) -> str:
    method = feature.attributes.get("source")
    if method:
        return method
    statuses = sorted(
        {
            record.attributes["status"]
            for record in records
            if record.attributes.get("status")
        }
    )
    return ",".join(statuses) if statuses else feature.source


Intervals = dict[str, list[tuple[int, int]]]


def read_unresolved_intervals(path: Path) -> tuple[Intervals, dict[str, int]]:
    """The FASTA's runs of bases that are not A, C, G, or T, per sequence, 0-based and half-open,
    and their bases counted as `n` (N) and `other`.

    Streams the file and keeps only the intervals, never the sequence.
    """
    intervals: Intervals = {}
    counts = {"n": 0, "other": 0}
    current: list[tuple[int, int]] | None = None
    position = 0
    with open(path, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if line.startswith(">"):
                current = intervals.setdefault(line[1:].split()[0], [])
                position = 0
                continue
            if current is None or not line:
                continue
            for match in _UNRESOLVED_RUN.finditer(line):
                start, end = position + match.start(), position + match.end()
                n = match.group().upper().count("N")
                counts["n"] += n
                counts["other"] += end - start - n
                if current and current[-1][1] == start:
                    current[-1] = (current[-1][0], end)
                else:
                    current.append((start, end))
            position += len(line)
    return intervals, counts


def write_bed(path: Path, intervals: Intervals) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for seqid, spans in intervals.items():
            for start, end in spans:
                handle.write(f"{seqid}\t{start}\t{end}\n")


def unresolved_in_cds(records: list[Feature], intervals: Intervals) -> int:
    """Unresolved bases in the union of the records' CDS, each position counted once."""
    count = 0
    by_seqid: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for record in records:
        if record.feature_type == "CDS":
            by_seqid[record.seqid].append((record.start - 1, record.end))
    for seqid, spans in by_seqid.items():
        unresolved = intervals.get(seqid, [])
        ends = [end for _start, end in unresolved]
        merged: list[tuple[int, int]] = []
        for start, end in sorted(spans):
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))
        for start, end in merged:
            index = bisect.bisect_right(ends, start)
            while index < len(unresolved) and unresolved[index][0] < end:
                count += min(end, unresolved[index][1]) - max(start, unresolved[index][0])
                index += 1
    return count


def protein_category(classes: list[str], protein_identity: float | None, target_id: str) -> str:
    unknown = sorted(set(classes) - KNOWN_MUTATION_CLASSES)
    if unknown:
        raise SummaryError(
            f"target '{target_id}' has mutation classes the rating does not know: {', '.join(unknown)}"
        )
    if protein_identity is None:
        return "lost"
    for category, category_classes in CATEGORY_CLASSES:
        if category_classes & set(classes):
            return category
    return "unchanged"


def review_reasons(
    category: str, protein_identity: float | None, unresolved: int, threshold_percent: int
) -> list[str]:
    reasons = []
    if category in ("unmapped", "lost"):
        reasons.append("unmapped_or_lost")
    if category == "disrupted":
        reasons.append("disrupted")
    # Both sides come from decimal text, so the fraction is compared rather than identity * 100.
    if protein_identity is not None and protein_identity < threshold_percent / 100:
        reasons.append("below_threshold")
    if unresolved:
        reasons.append("unresolved_bases")
    return reasons


def lifton_statuses(records: list[Feature]) -> str:
    return ",".join(sorted({record.attributes["status"] for record in records if record.attributes.get("status")}))


UNRATED = {"protein_category": "", "lifton_status": "", "unresolved_bases": "", "review_reasons": ""}


def build_detail_rows(
    reference_features: list[Feature],
    target_features: list[Feature],
    all_target: list[Feature],
    mapped_report: dict[str, ReportedFeature],
    unmapped_report: dict[str, ReportedFeature],
    unresolved: Intervals,
    threshold_percent: int,
) -> list[dict[str, object]]:
    reference_by_id = {feature.feature_id: feature for feature in reference_features}
    assert None not in reference_by_id
    reference_ids = set(reference_by_id)
    reported_ids = set(mapped_report) | set(unmapped_report)
    if set(mapped_report) & set(unmapped_report):
        overlap = sorted(set(mapped_report) & set(unmapped_report))[0]
        raise SummaryError(f"LiftOn reports feature '{overlap}' as both mapped and unmapped")
    if reported_ids != reference_ids:
        missing = sorted(reference_ids - reported_ids)
        unknown = sorted(reported_ids - reference_ids)
        raise SummaryError(
            f"LiftOn feature reports do not match the selected reference features; "
            f"missing={missing[:3]}, unknown={unknown[:3]}"
        )

    descendants = descendant_records(all_target)
    targets_by_reference: dict[str, list[tuple[int, Feature]]] = defaultdict(list)
    for target in target_features:
        copy_number, reference_id = copy_number_and_reference_id(target, reference_ids)
        targets_by_reference[reference_id].append((copy_number, target))

    rows: list[dict[str, object]] = []
    for reference in reference_features:
        reference_id = reference.feature_id
        assert reference_id is not None
        targets = sorted(targets_by_reference.get(reference_id, []), key=lambda item: item[0])
        reference_position = {
            "reference_seqid": reference.seqid,
            "reference_start": reference.start,
            "reference_end": reference.end,
            "reference_strand": reference.strand,
        }
        if reference_id in unmapped_report:
            if targets:
                raise SummaryError(
                    f"LiftOn reports '{reference_id}' as unmapped but the raw GFF3 contains a target"
                )
            rows.append(
                {
                    "reference_id": reference_id,
                    "feature_type": reference.feature_type,
                    **reference_position,
                    "lifton_category": unmapped_report[reference_id].category,
                    "status": "unmapped",
                    "copy_number": 0,
                    "target_id": "",
                    "target_seqid": "",
                    "target_start": "",
                    "target_end": "",
                    "target_strand": "",
                    "transfer_method": "",
                    "minimum_dna_identity": "",
                    "minimum_protein_identity": "",
                    "mutations": "",
                    **UNRATED,
                    **(
                        {"protein_category": "unmapped", "review_reasons": "unmapped_or_lost"}
                        if unmapped_report[reference_id].category == "coding"
                        else {}
                    ),
                }
            )
            continue

        report = mapped_report[reference_id]
        expected_numbers = set(range(report.copies))
        actual_numbers = {copy_number for copy_number, _target in targets}
        if len(targets) != report.copies or actual_numbers != expected_numbers:
            raise SummaryError(
                f"LiftOn reports {report.copies} copies for '{reference_id}', "
                f"but the raw GFF3 contains copy numbers {sorted(actual_numbers)}"
            )

        for copy_number, target in targets:
            target_id = target.feature_id
            assert target_id is not None
            records = [target, *descendants.get(target_id, [])]
            dna_identity = minimum_identity(records, "dna_identity")
            protein_identity = minimum_identity(records, "protein_identity")
            classes = mutation_classes(records)
            rating = dict(UNRATED)
            if copy_number == 0 and report.category == "coding":
                category = protein_category(classes, protein_identity, target_id)
                unresolved_bases = unresolved_in_cds(records, unresolved)
                rating = {
                    "protein_category": category,
                    "lifton_status": lifton_statuses(records),
                    "unresolved_bases": unresolved_bases,
                    "review_reasons": ",".join(
                        review_reasons(category, protein_identity, unresolved_bases, threshold_percent)
                    ),
                }
            rows.append(
                {
                    "reference_id": reference_id,
                    "feature_type": reference.feature_type,
                    **reference_position,
                    "lifton_category": report.category,
                    "status": "extra-copy" if copy_number else "mapped",
                    "copy_number": copy_number,
                    "target_id": target_id,
                    "target_seqid": target.seqid,
                    "target_start": target.start,
                    "target_end": target.end,
                    "target_strand": target.strand,
                    "transfer_method": transfer_method(target, records),
                    "minimum_dna_identity": dna_identity if dna_identity is not None else "",
                    "minimum_protein_identity": protein_identity
                    if protein_identity is not None
                    else "",
                    "mutations": ",".join(classes),
                    **rating,
                }
            )
    return rows


def identity_summary(features: list[Feature], attribute: str) -> dict[str, object]:
    values = [
        value
        for feature in features
        if (value := optional_float(feature.attributes.get(attribute), attribute, feature.feature_id or ""))
        is not None
    ]
    if not values:
        return {
            "unit": "transcript_model",
            "count": 0,
            "minimum": None,
            "mean": None,
            "maximum": None,
            "unavailable_reason": f"LiftOn emitted no {attribute} attributes for this run",
        }
    return {
        "unit": "transcript_model",
        "count": len(values),
        "minimum": min(values),
        "mean": fmean(values),
        "maximum": max(values),
    }


def verify_authoritative_reports(
    reference: list[Feature],
    target: list[Feature],
    mapped_report: dict[str, ReportedFeature],
    unmapped_report: dict[str, ReportedFeature],
    extra_report: dict[str, ReportedFeature],
    completeness: dict[str, CompletenessRow],
    manifest_counts: dict[str, int],
) -> None:
    if set(extra_report) != {
        feature_id for feature_id, report in mapped_report.items() if report.copies > 1
    }:
        raise SummaryError("LiftOn extra-copy and mapped-feature reports disagree")
    for feature_id, report in extra_report.items():
        if report != mapped_report[feature_id]:
            raise SummaryError(
                f"LiftOn reports inconsistent copy information for '{feature_id}'"
            )

    reference_by_id = {feature.feature_id: feature for feature in reference}
    reference_type_counts = Counter(feature.feature_type for feature in reference)
    mapped_type_counts = Counter(reference_by_id[feature_id].feature_type for feature_id in mapped_report)
    target_type_counts: Counter[str] = Counter()
    for feature_id, report in mapped_report.items():
        target_type_counts[reference_by_id[feature_id].feature_type] += report.copies
    unmapped_type_counts = Counter(
        reference_by_id[feature_id].feature_type for feature_id in unmapped_report
    )
    extra_feature_type_counts = Counter(
        reference_by_id[feature_id].feature_type for feature_id in extra_report
    )

    for feature_type, row in completeness.items():
        observed = (
            reference_type_counts[feature_type],
            mapped_type_counts[feature_type],
            unmapped_type_counts[feature_type],
            extra_feature_type_counts[feature_type],
            target_type_counts[feature_type],
        )
        reported = (
            row.reference,
            row.lifted,
            row.missed,
            row.features_with_extra_copies,
            row.target,
        )
        if observed != reported:
            raise SummaryError(
                f"LiftOn completeness report disagrees with its GFF3/reports for '{feature_type}': "
                f"reported={reported}, observed={observed}"
            )

    total_copies = sum(report.copies for report in mapped_report.values())
    expected_manifest = {
        "reference_features": len(mapped_report) + len(unmapped_report),
        "mapped_reference_features": len(mapped_report),
        "emitted_feature_copies": total_copies,
    }
    for field, expected in expected_manifest.items():
        if manifest_counts[field] != expected:
            raise SummaryError(
                f"LiftOn run manifest count '{field}' is {manifest_counts[field]}, "
                f"but its feature reports imply {expected}"
            )
    if len(target) != total_copies:
        raise SummaryError(
            f"LiftOn reports {total_copies} target copies, but its raw GFF3 contains {len(target)}"
        )


def evidence_entry(path: Path) -> dict[str, object]:
    return {"path": str(path), "available": path.exists()}


def write_details(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=DETAIL_COLUMNS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def collect(args: argparse.Namespace) -> tuple[dict, dict, list[dict[str, object]], Intervals]:
    stats_dir = args.diagnostics / "stats"
    selected_types_path = args.diagnostics / "intermediate_files" / "auto_feature_types.txt"
    run_manifest_path = args.diagnostics / "run_manifest.json"
    completeness_path = stats_dir / "completeness_by_feature_type.txt"
    mapped_path = stats_dir / "mapped_feature.txt"
    unmapped_path = stats_dir / "unmapped_features.txt"
    extra_path = stats_dir / "extra_copy_features.txt"

    selected_types = read_selected_feature_types(selected_types_path)
    _run_manifest, manifest_counts = parse_run_manifest(run_manifest_path)
    completeness = parse_completeness(completeness_path)
    mapped_report = parse_reported_features(mapped_path, mapped=True)
    unmapped_report = parse_reported_features(unmapped_path, mapped=False)
    extra_report = parse_reported_features(extra_path, mapped=True)

    reference_all = read_gff3_features(args.reference_gff3)
    target_all = read_gff3_features(args.raw_gff3)
    reference = top_level_features(reference_all, args.reference_gff3, selected_types)
    target = top_level_features(target_all, args.raw_gff3, selected_types)

    verify_authoritative_reports(
        reference,
        target,
        mapped_report,
        unmapped_report,
        extra_report,
        completeness,
        manifest_counts,
    )
    unresolved, unresolved_counts = read_unresolved_intervals(args.target_fasta)
    rows = build_detail_rows(
        reference,
        target,
        target_all,
        mapped_report,
        unmapped_report,
        unresolved,
        args.minimum_protein_identity,
    )
    rated = [row for row in rows if row["protein_category"]]
    reason_counts = Counter(
        reason for row in rated for reason in str(row["review_reasons"]).split(",") if reason
    )
    category_counts = Counter(str(row["protein_category"]) for row in rated)
    listed = sum(1 for row in rated if row["review_reasons"])
    exact = sum(
        1 for row in rated if not row["review_reasons"] and row["protein_category"] == "unchanged"
    )

    validation = read_json(args.validation)
    validation_gff3 = validation.get("gff3")
    if not isinstance(validation_gff3, dict):
        raise SummaryError(f"{args.validation} has no object-valued 'gff3' field")
    validation_errors = validation_gff3.get("errors", [])
    validation_warnings = validation_gff3.get("warnings", [])
    validation_status = validation.get("status")
    if not isinstance(validation_errors, list) or not isinstance(validation_warnings, list):
        raise SummaryError(f"{args.validation} errors and warnings must be arrays")
    if validation_status not in {"passed", "failed"}:
        raise SummaryError(f"{args.validation} has unsupported status '{validation_status}'")
    if (validation_status == "failed") != bool(validation_errors):
        raise SummaryError(f"{args.validation} status contradicts its error list")

    method_counts = Counter(str(row["transfer_method"]) for row in rows if row["transfer_method"])
    mutation_counts: Counter[str] = Counter()
    changed_primary_coding_ids: set[str] = set()
    for row in rows:
        mutations = [value for value in str(row["mutations"]).split(",") if value]
        if (
            row["status"] == "mapped"
            and row["lifton_category"] == "coding"
            and any(mutation not in UNCHANGED_PROTEIN_CLASSES for mutation in mutations)
        ):
            changed_primary_coding_ids.add(str(row["reference_id"]))
        mutation_counts.update(mutations)

    reference_by_type = {
        feature_type: row.reference for feature_type, row in sorted(completeness.items())
    }
    mapped_by_type = {
        feature_type: row.lifted for feature_type, row in sorted(completeness.items())
    }
    unmapped_by_type = {
        feature_type: row.missed for feature_type, row in sorted(completeness.items())
    }
    target_by_type = {
        feature_type: row.target for feature_type, row in sorted(completeness.items())
    }
    features_with_extra_by_type = {
        feature_type: row.features_with_extra_copies
        for feature_type, row in sorted(completeness.items())
    }
    extra_copy_count = sum(report.copies - 1 for report in extra_report.values())

    generated_at = utc_now_iso()
    metrics = {
        "schema_version": METRICS_SCHEMA_VERSION,
        "generated_at": generated_at,
        "workflow": {"id": args.workflow_id, "version": args.workflow_version},
        "definitions": METRIC_EXPLANATIONS,
        "detail_column_definitions": DETAIL_EXPLANATIONS,
        "transfer": {
            "reference_features": manifest_counts["reference_features"],
            "reference_features_by_type": reference_by_type,
            "mapped_features": manifest_counts["mapped_reference_features"],
            "mapped_features_by_type": mapped_by_type,
            "unmapped_features": manifest_counts["reference_features"]
            - manifest_counts["mapped_reference_features"],
            "unmapped_features_by_type": unmapped_by_type,
            "mapping_fraction": manifest_counts["mapped_reference_features"]
            / manifest_counts["reference_features"],
            "target_feature_copies": manifest_counts["emitted_feature_copies"],
            "target_feature_copies_by_type": target_by_type,
            "features_with_extra_copies": len(extra_report),
            "features_with_extra_copies_by_type": features_with_extra_by_type,
            "extra_copies": extra_copy_count,
            "miniprot_rescues": manifest_counts["miniprot_rescued_genes"],
            "transfer_methods_by_target_copy": dict(sorted(method_counts.items())),
            "changed_primary_protein_coding_features": len(changed_primary_coding_ids),
            "mutation_classifications_by_target_copy": dict(sorted(mutation_counts.items())),
            "dna_identity_by_transcript_model": identity_summary(target_all, "dna_identity"),
            "protein_identity_by_transcript_model": identity_summary(
                target_all, "protein_identity"
            ),
            "authoritative_sources": [
                str(run_manifest_path),
                str(completeness_path),
                str(mapped_path),
                str(unmapped_path),
                str(extra_path),
                str(selected_types_path),
            ],
            "detail_enrichment_source": str(args.raw_gff3),
        },
        "proteins": {
            "minimum_protein_identity_percent": args.minimum_protein_identity,
            "rated_genes": len(rated),
            "genes_by_category": {category: category_counts[category] for category in PROTEIN_CATEGORIES},
            "genes_by_review_reason": {reason: reason_counts[reason] for reason in REVIEW_REASONS},
            "genes_listed_for_review": listed,
            "genes_by_match": {
                "exact_match": exact,
                "near_match": len(rated) - listed - exact,
                "needs_review": listed,
            },
            "unresolved_target_bases": unresolved_counts,
            "source": str(args.details),
            "unresolved_intervals": str(args.unresolved_bed),
        },
        "validation": {
            "status": validation_status,
            "errors": len(validation_errors),
            "warnings": len(validation_warnings),
            "source": str(args.validation),
            "explanation": "Structural General Feature Format version 3 (GFF3) validation of identifiers, parent references, coordinates, strand, and coding-sequence (CDS) phase.",
        },
    }

    if validation_status == "failed":
        completion_status = "validation-failed"
        completion_status_explanation = (
            "LiftOn completed, but the transferred annotation failed structural validation."
        )
    elif validation_warnings:
        completion_status = "completed-with-warnings"
        completion_status_explanation = (
            "LiftOn completed and validation found no errors, but warnings should be reviewed."
        )
    else:
        completion_status = "completed"
        completion_status_explanation = "LiftOn completed and structural validation passed."

    evidence_paths = {
        "raw_gff3": args.raw_gff3,
        "lifton_diagnostics": args.diagnostics,
        "run_manifest": run_manifest_path,
        "completeness_by_feature_type": completeness_path,
        "mapped_features": mapped_path,
        "mapped_transcripts": stats_dir / "mapped_transcript.txt",
        "unmapped_features": unmapped_path,
        "extra_copy_features": extra_path,
        "selected_feature_types": selected_types_path,
    }
    summary = {
        "schema_version": SUMMARY_SCHEMA_VERSION,
        "generated_at": generated_at,
        "workflow": {"id": args.workflow_id, "version": args.workflow_version},
        "run": {
            "id": args.run_id,
            "created_at": args.run_created_at,
            "effective_cpus": args.effective_cpus,
        },
        "status": completion_status,
        "status_explanation": completion_status_explanation,
        "metrics": {
            "schema_version": METRICS_SCHEMA_VERSION,
            "path": str(args.metrics),
            "payload": metrics,
        },
        "generated_reports": {
            "feature_transfer": str(args.details),
            "aggregated_metrics": str(args.metrics),
            "completion_summary": str(args.summary),
            "validation": str(args.validation),
            "target_unresolved_bed": str(args.unresolved_bed),
        },
        "source_evidence": {
            name: evidence_entry(path) for name, path in evidence_paths.items()
        },
    }
    return metrics, summary, rows, unresolved


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-gff3", type=Path, required=True)
    parser.add_argument("--raw-gff3", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--target-fasta", type=Path, required=True)
    parser.add_argument("--minimum-protein-identity", type=int, required=True)
    parser.add_argument("--unresolved-bed", type=Path, required=True)
    parser.add_argument("--diagnostics", type=Path, required=True)
    parser.add_argument("--details", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--workflow-version", type=int, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-created-at", required=True)
    parser.add_argument("--effective-cpus", type=int, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        metrics, summary, rows, unresolved = collect(args)
        write_bed(args.unresolved_bed, unresolved)
        write_details(args.details, rows)
        write_json(args.metrics, metrics)
        write_json(args.summary, summary)
    except (OSError, SummaryError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
