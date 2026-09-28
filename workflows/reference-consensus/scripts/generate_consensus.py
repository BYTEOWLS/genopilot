#!/usr/bin/env python3
"""Choose the cohort allele at every backbone position and write the cohort consensus.

Inputs are cohort support aggregation's outputs (aggregate_support.py): the
sites table (one row per locus), the intervals table (every backbone base in
runs of constant votes), the support summary, and the backbone FASTA with its
index. Only these are read, so the consensus is reproducible from them and
the three policies below.

Decisions, at a locus of the sites table or a run of bases outside every
locus (where every vote is for the backbone base), in this order:

  1. no votes at all                                    -> unresolved, `no_votes`
  2. fewer voting isolates than --min-callable-isolates -> unresolved, `few_callable`
  3. strict-majority: the top allele has more than half of the votes;
     plurality: the top allele is unique                -> selected
     otherwise                                          -> unresolved, `tie` when
                                                           the top alleles are tied,
                                                           else `no_majority`

A selected allele replaces the locus's whole backbone span; a base of it that
is not A, C, G, or T (only the backbone's own, such as an assembly gap) is
written as N. An unresolved locus is written as N for every base of its
backbone allele, so no concrete base is invented and the consensus stays
aligned with the backbone there. The one exception is an unresolved SNP, a
tie or no majority between single-base alleles only: with
--unresolved-snp iupac it is written as the IUPAC code of every allele that
received a vote (A=5, G=5 -> R).

Writes (1-based, inclusive coordinates; contigs in backbone order):

  --fasta            the cohort consensus, with the backbone's sequence IDs and
                     order, in lines of 60 bases
  --consensus-sites  TSV, one row per locus of the sites table (`kind` locus)
                     and per run of unresolved bases outside the loci (`kind`
                     region, written as N throughout): its backbone and
                     consensus span, status, reason, selected allele, the
                     sequence written, and the locus's votes and flags
  --summary          JSON: the policies, voters, input and FASTA checksums,
                     sequence lengths, loci by status and reason (in total and
                     per support flag) and by total votes, and bases written
                     from the backbone alone, as IUPAC codes, and as N

The output depends only on the inputs and carries no timestamps.

Standard library only.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, TextIO, TypeVar

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aggregate_support import FLAGS, SITE_COLUMNS, read_fai, read_fasta  # noqa: E402
from artifacts import sha256_file  # noqa: E402

SCHEMA_VERSION = 1
INTERVAL_COLUMNS = ("chrom", "start", "end", "backbone_votes", "callable_isolates")
T = TypeVar("T")
VOTING_METHODS = ("strict-majority", "plurality")
UNRESOLVED_SNP = ("n", "iupac")
REASONS = ("tie", "no_majority", "no_votes", "few_callable")
LINE_WIDTH = 60
NOT_ACGT = re.compile(r"[^ACGT]")
ACGT_BASE = re.compile(r"^[ACGT]$")
IUPAC = {
    "AG": "R", "CT": "Y", "CG": "S", "AT": "W", "GT": "K", "AC": "M",
    "CGT": "B", "AGT": "D", "ACT": "H", "ACG": "V", "ACGT": "N",
}

CONSENSUS_SITE_COLUMNS = (
    "chrom", "start", "end", "consensus_start", "consensus_end", "kind", "status", "reason", "allele",
    "written", "backbone_allele", "alleles", "allele_votes", "callable_isolates", "total_votes", "flags",
)


@dataclass(frozen=True)
class Policy:
    voting_method: str
    min_callable_isolates: int
    unresolved_snp: str


@dataclass(frozen=True)
class Locus:
    """A row of the sites table, 0-based and half-open on the backbone."""

    start: int
    end: int
    backbone_allele: str
    alleles: tuple[str, ...]
    votes: tuple[int, ...]
    callable_isolates: int
    total_votes: int
    flags: tuple[str, ...]


@dataclass(frozen=True)
class Interval:
    """A row of the intervals table, 0-based and half-open on the backbone."""

    start: int
    end: int
    backbone_votes: int
    callable_isolates: int


def open_text(path: Path) -> TextIO:
    """A plain or gzip/bgzip-compressed text file, chosen by its suffix."""
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open(encoding="utf-8")


def table_rows(path: Path, columns: tuple[str, ...]) -> Iterator[dict[str, str]]:
    """The given leading columns of a support table's rows; `##` lines are metadata and `#` the header.

    Only these columns are split off, so the per-isolate columns of the sites table cost nothing.
    """
    with open_text(path) as table:
        for line in table:
            if line.startswith("##") or line == "\n":
                continue
            if line.startswith("#"):
                if tuple(line[1:].rstrip("\n").split("\t")[:len(columns)]) != columns:
                    raise ValueError(f"{path} does not start with the columns {', '.join(columns)}")
                break
        else:
            raise ValueError(f"{path} has no header line")
        for line in table:
            yield dict(zip(columns, line.rstrip("\n").split("\t", len(columns))))


class ContigRows:
    """The rows of a table sorted by contig in backbone order, parsed and handed out one contig at a time."""

    def __init__(self, rows: Iterator[dict[str, str]], parse: Callable[[dict[str, str]], T]) -> None:
        self._rows = rows
        self._parse = parse
        self._next = next(rows, None)

    def take(self, chrom: str) -> list[T]:
        taken = []
        while self._next is not None and self._next["chrom"] == chrom:
            taken.append(self._parse(self._next))
            self._next = next(self._rows, None)
        return taken

    def finish(self, path: Path) -> None:
        if self._next is not None:
            raise ValueError(f"{path} has rows for {self._next['chrom']} out of backbone order or not in the backbone")


def parse_locus(row: dict[str, str]) -> Locus:
    return Locus(
        start=int(row["start"]) - 1,
        end=int(row["end"]),
        backbone_allele=row["backbone_allele"],
        alleles=tuple(row["alleles"].split(",")),
        votes=tuple(int(votes) for votes in row["allele_votes"].split(",")),
        callable_isolates=int(row["callable_isolates"]),
        total_votes=int(row["total_votes"]),
        flags=() if row["flags"] == "." else tuple(row["flags"].split(",")),
    )


def parse_interval(row: dict[str, str]) -> Interval:
    return Interval(int(row["start"]) - 1, int(row["end"]), int(row["backbone_votes"]), int(row["callable_isolates"]))


def decide(votes: dict[str, int], total_votes: int, callable_isolates: int, policy: Policy) -> tuple[str, str | None]:
    """(reason, selected allele): the reason is `.` when an allele is selected, which is then not None."""
    if total_votes == 0:
        return "no_votes", None
    if callable_isolates < policy.min_callable_isolates:
        return "few_callable", None
    top = max(votes.values())
    leaders = [allele for allele, count in votes.items() if count == top]
    if len(leaders) > 1:
        return "tie", None
    if policy.voting_method == "strict-majority" and top * 2 <= total_votes:
        return "no_majority", None
    return ".", leaders[0]


def written_for(locus: Locus, reason: str, allele: str | None, policy: Policy) -> str:
    """The sequence the consensus holds for a locus."""
    if allele is not None:
        return NOT_ACGT.sub("N", allele)
    voted = sorted(a for a, count in zip(locus.alleles, locus.votes) if count > 0)
    snp = len(locus.backbone_allele) == 1 and all(ACGT_BASE.match(a) for a in voted)
    if policy.unresolved_snp == "iupac" and reason in ("tie", "no_majority") and snp:
        return IUPAC["".join(voted)]
    return "N" * len(locus.backbone_allele)


@dataclass
class Tally:
    """What the whole consensus adds up to."""

    loci: Counter
    loci_by_flag: dict[str, Counter]
    loci_by_votes: dict[str, Counter]
    bases: Counter
    changed_loci: int = 0

    @classmethod
    def empty(cls) -> "Tally":
        return cls(Counter(), {flag: Counter() for flag in FLAGS}, {"selected": Counter(), "unresolved": Counter()}, Counter())


def consensus_contig(
    chrom: str,
    sequence: str,
    loci: list[Locus],
    intervals: list[Interval],
    policy: Policy,
    tally: Tally,
    sites: TextIO,
) -> str:
    """The contig's consensus sequence; writes its rows of the consensus-sites table."""
    pieces: list[str] = []
    delta = 0  # consensus length minus backbone length so far
    region: list | None = None  # an open run of unresolved bases: [start, end, reason, callable, total]

    def close_region() -> None:
        nonlocal region
        if region is None:
            return
        start, end, reason, callable_isolates, total_votes = region
        sites.write("\t".join([
            chrom, str(start + 1), str(end), str(start + delta + 1), str(end + delta), "region", "unresolved",
            reason, ".", ".", ".", ".", ".", str(callable_isolates), str(total_votes), ".",
        ]) + "\n")
        region = None

    def emit_bases(start: int, end: int, interval: Interval) -> None:
        nonlocal region
        total_votes = interval.backbone_votes + interval.callable_isolates
        # Outside a locus every vote is for the backbone base, so only the counts decide.
        reason, _ = decide({"backbone": total_votes}, total_votes, interval.callable_isolates, policy)
        if reason == ".":
            bases = sequence[start:end]
            pieces.append(NOT_ACGT.sub("N", bases))
            tally.bases["n_backbone_not_acgt"] += sum(1 for _ in NOT_ACGT.finditer(bases))
            if interval.callable_isolates == 0:
                tally.bases["backbone_only"] += end - start
            close_region()
            return
        pieces.append("N" * (end - start))
        tally.bases[f"n_{reason}"] += end - start
        key = (reason, interval.callable_isolates, total_votes)
        if region is not None and region[1] == start and tuple(region[2:]) == key:
            region[1] = end
        else:
            close_region()
            region = [start, end, *key]

    def emit_locus(locus: Locus) -> None:
        nonlocal delta
        close_region()
        if sequence[locus.start:locus.end] != locus.backbone_allele:
            raise ValueError(f"the sites table's backbone allele at {chrom}:{locus.start + 1} does not match the backbone")
        reason, allele = decide(dict(zip(locus.alleles, locus.votes)), locus.total_votes, locus.callable_isolates, policy)
        written = written_for(locus, reason, allele, policy)
        status = "selected" if allele is not None else "unresolved"
        consensus_start = locus.start + delta + 1
        pieces.append(written)
        delta += len(written) - (locus.end - locus.start)

        tally.loci[status if allele is not None else reason] += 1
        for flag in locus.flags:
            tally.loci_by_flag[flag][status if allele is not None else reason] += 1
        tally.loci_by_votes[status][locus.total_votes] += 1
        if allele is not None:
            tally.changed_loci += allele != locus.backbone_allele
            tally.bases["n_backbone_not_acgt"] += written.count("N")
        elif written != "N" * len(written):
            tally.bases["iupac"] += len(written)
        else:
            tally.bases[f"n_{reason}"] += len(written)

        sites.write("\t".join([
            chrom, str(locus.start + 1), str(locus.end), str(consensus_start), str(consensus_start + len(written) - 1),
            "locus", status, reason, allele or ".", written, locus.backbone_allele, ",".join(locus.alleles),
            ",".join(map(str, locus.votes)), str(locus.callable_isolates), str(locus.total_votes),
            ",".join(locus.flags) or ".",
        ]) + "\n")

    position = 0
    next_locus = 0
    for interval in intervals:
        start = max(interval.start, position)
        while start < interval.end:
            if next_locus < len(loci) and loci[next_locus].start == start:
                emit_locus(loci[next_locus])
                position = start = loci[next_locus].end
                next_locus += 1
                continue
            end = interval.end
            if next_locus < len(loci):
                end = min(end, loci[next_locus].start)
            emit_bases(start, end, interval)
            position = start = end
    close_region()
    if position != len(sequence) or next_locus != len(loci):
        raise ValueError(f"the support tables do not cover {chrom} exactly once")
    consensus = "".join(pieces)
    if len(consensus) != len(sequence) + delta:
        raise ValueError(f"the consensus of {chrom} has an unexpected length")
    return consensus


def write_fasta_record(fasta: TextIO, name: str, sequence: str) -> None:
    fasta.write(f">{name}\n")
    for offset in range(0, len(sequence), LINE_WIDTH):
        fasta.write(sequence[offset:offset + LINE_WIDTH] + "\n")


def generate(
    fai: Path,
    backbone: Path,
    sites_path: Path,
    intervals_path: Path,
    support_summary_path: Path,
    policy: Policy,
    fasta: TextIO,
    sites: TextIO,
) -> dict:
    support_summary = json.loads(support_summary_path.read_text(encoding="utf-8"))
    sites.write(f"## schema_version: {SCHEMA_VERSION}\n")
    sites.write(f"## voting_method: {policy.voting_method}\n")
    sites.write(f"## min_callable_isolates: {policy.min_callable_isolates}\n")
    sites.write(f"## unresolved_snp: {policy.unresolved_snp}\n")
    sites.write("#" + "\t".join(CONSENSUS_SITE_COLUMNS) + "\n")

    site_rows = ContigRows(table_rows(sites_path, SITE_COLUMNS), parse_locus)
    interval_rows = ContigRows(table_rows(intervals_path, INTERVAL_COLUMNS), parse_interval)
    sequences = read_fasta(backbone)
    tally = Tally.empty()
    contigs = []
    for chrom, length in read_fai(fai):
        name, sequence = next(sequences)
        if name != chrom or len(sequence) != length:
            raise ValueError(f"the backbone FASTA does not match its index at {chrom}")
        loci = site_rows.take(chrom)
        intervals = interval_rows.take(chrom)
        consensus = consensus_contig(chrom, sequence, loci, intervals, policy, tally, sites)
        write_fasta_record(fasta, chrom, consensus)
        contigs.append({"name": chrom, "backbone_length": length, "consensus_length": len(consensus)})
    site_rows.finish(sites_path)
    interval_rows.finish(intervals_path)

    def by_reason(counts: Counter) -> dict:
        return {"selected": counts["selected"], "unresolved": {reason: counts[reason] for reason in REASONS}}

    return {
        "schema_version": SCHEMA_VERSION,
        "voting_method": policy.voting_method,
        "min_callable_isolates": policy.min_callable_isolates,
        "unresolved_snp": policy.unresolved_snp,
        "include_backbone_vote": support_summary["include_backbone_vote"],
        "voters": support_summary["voters"],
        "inputs": {
            name: {"path": path.as_posix(), "sha256": sha256_file(path)}
            for name, path in (
                ("backbone", backbone),
                ("support_sites", sites_path),
                ("support_intervals", intervals_path),
                ("support_summary", support_summary_path),
            )
        },
        "contigs": contigs,
        "loci": {**by_reason(tally.loci), "changed": tally.changed_loci},
        "loci_by_flag": {flag: by_reason(tally.loci_by_flag[flag]) for flag in FLAGS},
        "loci_by_total_votes": {
            status: {str(votes): count for votes, count in sorted(counts.items())}
            for status, counts in tally.loci_by_votes.items()
        },
        "bases": {
            "backbone_only": tally.bases["backbone_only"],
            "iupac": tally.bases["iupac"],
            "n": {
                reason: tally.bases[f"n_{reason}"] for reason in (*REASONS, "backbone_not_acgt")
            },
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fai", type=Path, required=True)
    parser.add_argument("--backbone", type=Path, required=True)
    parser.add_argument("--sites", type=Path, required=True)
    parser.add_argument("--intervals", type=Path, required=True)
    parser.add_argument("--support-summary", type=Path, required=True)
    parser.add_argument("--voting-method", choices=VOTING_METHODS, required=True)
    parser.add_argument("--min-callable-isolates", type=int, required=True)
    parser.add_argument("--unresolved-snp", choices=UNRESOLVED_SNP, required=True)
    parser.add_argument("--fasta", type=Path, required=True)
    parser.add_argument("--consensus-sites", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    policy = Policy(args.voting_method, args.min_callable_isolates, args.unresolved_snp)
    for path in (args.fasta, args.consensus_sites, args.summary):
        path.parent.mkdir(parents=True, exist_ok=True)
    with args.fasta.open("w", encoding="utf-8") as fasta, args.consensus_sites.open("w", encoding="utf-8") as sites:
        summary = generate(
            args.fai, args.backbone, args.sites, args.intervals, args.support_summary, policy, fasta, sites,
        )
    summary["outputs"] = {"fasta": {"path": args.fasta.as_posix(), "sha256": sha256_file(args.fasta)}}
    args.summary.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
