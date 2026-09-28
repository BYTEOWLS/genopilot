#!/usr/bin/env python3
"""Count the backbone's and the callable isolates' votes at every backbone position.

Inputs, per voting isolate (`--voter ID VCF MASK`, repeated):

  VCF   the isolate's normalized variants (variants.vcf.gz); only `PASS`
        records are evidence
  MASK  the isolate's callable mask (callable-mask.bed): callable, ambiguous,
        or uncallable for every backbone base

and the backbone FASTA with its index. No winner is chosen here.

Votes
  - The backbone casts one vote when --include-backbone-vote is `yes`, but
    never where its own base is not A, C, G, or T.
  - An isolate casts one vote only where every base of the position or locus
    is callable. It votes its variant allele there, or the backbone allele
    when it has no variant. An ambiguous or uncallable isolate casts no vote,
    so missing evidence is never a backbone vote. Depth never adds votes.

Loci
  `PASS` records of all isolates whose backbone spans overlap form one locus.
  Every voter's allele at a locus is the locus's backbone sequence with its
  own records applied, so a SNP inside another isolate's deletion, competing
  indels, and different SNPs at one base are all one ballot with at most one
  vote per voter. The caller reports a base change and an indel at the same
  position as two records; they are combined into one allele (a SNP `G>T` and
  an insertion `G>GGAT` become `G>TGAT`). An isolate whose own records
  otherwise overlap within a locus, or whose allele has another base than A,
  C, G, or T, is `unsupported` there and casts no vote.

Writes (1-based, inclusive coordinates; contigs in backbone order):

  --sites      TSV, one row per locus: the backbone allele and its vote, the
               alleles (backbone allele first, then by votes, then
               alphabetically) with their votes, flags, and one column per
               isolate (`isolate:<id>`, in ID order) holding its allele's
               index or its state
  --intervals  TSV, every backbone base in runs of constant voter states:
               the backbone vote, the number of callable, ambiguous, and
               uncallable isolates, and `states`, one letter per isolate in
               the order of the `## isolates:` header line (`c` callable,
               `a` ambiguous, `u` uncallable). Inside a locus, the locus's
               row in --sites is authoritative.
  --summary    JSON: voters, backbone vote, input checksums, vote and
               callability histograms, site counts per flag, the allele
               frequency spectrum of biallelic loci, and per-isolate counts

The output depends only on the inputs, not on the order of the voters, and
carries no timestamps.

Standard library only.
"""

from __future__ import annotations

import argparse
import bisect
import gzip
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from itertools import groupby
from pathlib import Path
from typing import Iterator, TextIO

sys.path.insert(0, str(Path(__file__).resolve().parent))

from artifacts import sha256_file  # noqa: E402

SCHEMA_VERSION = 1
UNCALLABLE, AMBIGUOUS, CALLABLE = 0, 1, 2
STATES = {"uncallable": UNCALLABLE, "ambiguous": AMBIGUOUS, "callable": CALLABLE}
STATE_LETTERS = {UNCALLABLE: ord("u"), AMBIGUOUS: ord("a"), CALLABLE: ord("c")}
LETTER_STATES = {letter: state for state, letter in STATE_LETTERS.items()}
CALLABLE_LETTER = STATE_LETTERS[CALLABLE]
# An isolate's entry in the sites table before its own records are looked at.
LETTER_CALLS = {STATE_LETTERS[CALLABLE]: "0", STATE_LETTERS[AMBIGUOUS]: "ambiguous", STATE_LETTERS[UNCALLABLE]: "uncallable"}
UNSUPPORTED = "unsupported"
FLAGS = ("snp", "indel", "multiallelic", "overlapping", "competing_indel", "unsupported", "backbone_not_acgt")
ACGT = re.compile(r"^[ACGT]+$")
NOT_ACGT = re.compile(r"[^ACGT]+")

SITE_COLUMNS = (
    "chrom", "start", "end", "backbone_allele", "backbone_votes", "alleles", "allele_votes",
    "callable_isolates", "total_votes", "flags",
)
INTERVAL_COLUMNS = (
    "chrom", "start", "end", "backbone_votes", "callable_isolates", "ambiguous_isolates",
    "uncallable_isolates", "states",
)


@dataclass(frozen=True)
class Record:
    """A PASS variant, 0-based and half-open on the backbone."""

    start: int
    end: int
    ref: str
    alt: str


@dataclass
class Mask:
    """One contig of an isolate's callable mask, as sorted intervals."""

    starts: list[int] = field(default_factory=list)
    ends: list[int] = field(default_factory=list)
    states: list[int] = field(default_factory=list)

    def worst_state(self, start: int, end: int) -> int:
        """The lowest state of the bases in [start, end); bases outside the mask are uncallable."""
        index = bisect.bisect_right(self.starts, start) - 1
        if index < 0 or self.ends[index] <= start:
            return UNCALLABLE
        worst = CALLABLE
        position = start
        while position < end:
            if index >= len(self.starts) or self.starts[index] > position:
                return UNCALLABLE
            worst = min(worst, self.states[index])
            position = self.ends[index]
            index += 1
        return worst


@dataclass
class Voter:
    id: str
    vcf: Path
    mask_path: Path
    records: dict[str, list[Record]] = field(default_factory=dict)
    masks: dict[str, Mask] = field(default_factory=dict)


def read_fai(path: Path) -> list[tuple[str, int]]:
    contigs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line:
            name, length = line.split("\t")[:2]
            contigs.append((name, int(length)))
    return contigs


def read_fasta(path: Path) -> Iterator[tuple[str, str]]:
    """Yields (name, uppercase sequence) per record, in file order."""
    name: str | None = None
    chunks: list[str] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n\r")
            if line.startswith(">"):
                if name is not None:
                    yield name, "".join(chunks).upper()
                name, chunks = line[1:].split()[0], []
            elif line:
                chunks.append(line)
    if name is not None:
        yield name, "".join(chunks).upper()


def read_pass_records(path: Path) -> dict[str, list[Record]]:
    """The PASS records of a (bgzip-compressed) VCF by contig, split into one per ALT."""
    records: dict[str, list[Record]] = {}
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as vcf:
        for line in vcf:
            if line.startswith("#"):
                continue
            fields = line.rstrip("\n").split("\t")
            chrom, position, ref, alts, status = fields[0], int(fields[1]), fields[3], fields[4], fields[6]
            if status != "PASS":
                continue
            start = position - 1
            for alt in alts.split(","):
                records.setdefault(chrom, []).append(Record(start, start + len(ref), ref.upper(), alt.upper()))
    for contig_records in records.values():
        contig_records.sort(key=lambda record: (record.start, record.end, record.alt))
    return records


def read_mask(path: Path) -> dict[str, Mask]:
    masks: dict[str, Mask] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        chrom, start, end, state = line.split("\t")
        mask = masks.setdefault(chrom, Mask())
        mask.starts.append(int(start))
        mask.ends.append(int(end))
        mask.states.append(STATES[state])
    return masks


def load_voter(voter_id: str, vcf: Path, mask: Path) -> Voter:
    return Voter(voter_id, vcf, mask, read_pass_records(vcf), read_mask(mask))


def loci(voters: list[Voter], chrom: str) -> list[tuple[int, int, dict[str, list[Record]]]]:
    """Clusters of overlapping PASS records of all voters: (start, end, records by voter)."""
    spans = sorted(
        ((record.start, record.end, voter.id, record) for voter in voters for record in voter.records.get(chrom, [])),
        key=lambda span: (span[0], span[1], span[2], span[3].alt),
    )
    clusters: list[tuple[int, int, dict[str, list[Record]]]] = []
    for start, end, voter_id, record in spans:
        if clusters and start < clusters[-1][1]:
            cluster_start, cluster_end, members = clusters[-1]
            clusters[-1] = (cluster_start, max(cluster_end, end), members)
        else:
            members = {}
            clusters.append((start, end, members))
        members.setdefault(voter_id, []).append(record)
    return clusters


def combine_anchor_records(records: list[Record]) -> list[Record] | None:
    """One voter's records with a SNP and an indel at the same position combined into one record.

    Returns None when records share a position in any other way.
    """
    combined: list[Record] = []
    for _, group in groupby(records, key=lambda record: record.start):
        group = list(group)
        if len(group) == 1:
            combined.append(group[0])
            continue
        snps = [r for r in group if len(r.ref) == 1 and len(r.alt) == 1]
        indels = [r for r in group if len(r.ref) != len(r.alt)]
        if len(group) != 2 or len(snps) != 1 or len(indels) != 1:
            return None
        snp, indel = snps[0], indels[0]
        if snp.ref != indel.ref[:1] or indel.alt[:1] != indel.ref[:1]:
            return None
        combined.append(Record(indel.start, indel.end, indel.ref, snp.alt + indel.alt[1:]))
    return combined


def apply_records(sequence: str, start: int, end: int, records: list[Record]) -> str | None:
    """The locus's sequence with one voter's records applied, or None when they cannot be applied."""
    pieces = []
    position = start
    for record in records:
        if record.start < position or sequence[record.start:record.end] != record.ref or not ACGT.match(record.alt):
            return None
        pieces.append(sequence[position:record.start])
        pieces.append(record.alt)
        position = record.end
    pieces.append(sequence[position:end])
    return "".join(pieces)


def callable_count_without_records(letters: bytes, carriers: dict[int, str | None]) -> int:
    """The callable isolates without records at a locus, which vote for the backbone allele."""
    return letters.count(CALLABLE_LETTER) - len(carriers)


def site_row(
    chrom: str,
    sequence: str,
    start: int,
    end: int,
    members: dict[str, list[Record]],
    voter_index: dict[str, int],
    letters: bytes,
    backbone_vote: bool,
) -> tuple[list[str], dict[int, str | None], list[str]]:
    """One locus: its TSV fields, the allele of every callable isolate with records (None when
    unsupported), and its flags.

    `letters` holds every isolate's state over the whole locus. A callable isolate without records
    votes for the backbone allele, so only the isolates with records are looked at one by one.
    """
    backbone_allele = sequence[start:end]
    backbone_votes = 1 if backbone_vote and ACGT.match(backbone_allele) else 0
    carriers: dict[int, str | None] = {}
    for voter_id, voter_records in members.items():
        index = voter_index[voter_id]
        if letters[index] != CALLABLE_LETTER:
            continue
        combined = combine_anchor_records(voter_records)
        carriers[index] = None if combined is None else apply_records(sequence, start, end, combined)

    callable_count = letters.count(CALLABLE_LETTER)
    unsupported = sum(1 for allele in carriers.values() if allele is None)
    votes = Counter(allele for allele in carriers.values() if allele is not None)
    votes[backbone_allele] += callable_count_without_records(letters, carriers) + backbone_votes
    others = sorted((allele for allele in votes if allele != backbone_allele), key=lambda a: (-votes[a], a))
    alleles = [backbone_allele, *others]
    allele_index = {allele: position for position, allele in enumerate(alleles)}

    # The locus's own records describe it too, also those of isolates without a vote.
    indel = any(len(allele) != len(backbone_allele) for allele in alleles) or any(
        len(record.ref) != len(record.alt) for voter_records in members.values() for record in voter_records
    )
    record_spans = {(record.start, record.end) for voter_records in members.values() for record in voter_records}
    flags = []
    if not indel and len(backbone_allele) == 1:
        flags.append("snp")
    if indel:
        flags.append("indel")
    if len(alleles) > 2:
        flags.append("multiallelic")
    if len(record_spans) > 1 and len(members) > 1:
        flags.append("overlapping")
    if indel and len(others) > 1:
        flags.append("competing_indel")
    if unsupported:
        flags.append("unsupported")
    if not ACGT.match(backbone_allele):
        flags.append("backbone_not_acgt")

    fields = [
        chrom, str(start + 1), str(end), backbone_allele, str(backbone_votes),
        ",".join(alleles), ",".join(str(votes[allele]) for allele in alleles),
        str(callable_count - unsupported), str(sum(votes.values())), ",".join(flags) or ".",
    ]
    # Index 0 is the backbone allele, the vote of every callable isolate without records.
    calls = list(map(LETTER_CALLS.__getitem__, letters))
    for index, allele in carriers.items():
        calls[index] = UNSUPPORTED if allele is None else str(allele_index[allele])
    return fields + calls, carriers, flags


@dataclass
class Sweep:
    """Every isolate's state along one contig, and what it adds up to per isolate.

    `bases` and `loci` count, per isolate and state, the bases and the loci of the contig that
    the sweep covered; a locus is counted with `add_locus` while its row is current.
    """

    bases: list[list[int]]
    loci: list[list[int]]
    loci_seen: int = 0


def interval_rows(
    chrom: str,
    sequence: str,
    voters: list[Voter],
    backbone_vote: bool,
    sweep: Sweep,
) -> Iterator[tuple[int, int, int, list[int], bytes]]:
    """Yields (start, end, backbone votes, isolates per state, state letters) for every run of constant states.

    Only the isolates whose state changes at a boundary are updated. A row is yielded before the
    next boundary's changes are applied, so the sweep describes the row while the caller holds it.
    """
    length = len(sequence)
    if length == 0:
        return
    changes: dict[int, list[tuple[int, int]]] = {0: []}
    for index, voter in enumerate(voters):
        mask = voter.masks.get(chrom, Mask())
        covered = 0
        for start, end, state in zip(mask.starts, mask.ends, mask.states):
            if start > covered:
                changes.setdefault(covered, []).append((index, UNCALLABLE))
            changes.setdefault(start, []).append((index, state))
            covered = end
        if covered < length:
            changes.setdefault(covered, []).append((index, UNCALLABLE))
    gaps = [(match.start(), match.end()) for match in NOT_ACGT.finditer(sequence)]
    for start, end in gaps:
        changes.setdefault(start, [])
        changes.setdefault(end, [])
    gap_starts = [start for start, _ in gaps]

    def backbone_votes_at(position: int) -> int:
        index = bisect.bisect_right(gap_starts, position) - 1
        in_gap = index >= 0 and gaps[index][1] > position
        return 1 if backbone_vote and not in_gap else 0

    current = [UNCALLABLE] * len(voters)
    since_base = [0] * len(voters)
    since_locus = [0] * len(voters)
    letters = bytearray([STATE_LETTERS[UNCALLABLE]]) * len(voters)
    counts = [0, 0, 0]
    counts[UNCALLABLE] = len(voters)

    def apply(position: int) -> None:
        for index, state in changes[position]:
            old = current[index]
            if old == state:
                continue
            sweep.bases[index][old] += position - since_base[index]
            sweep.loci[index][old] += sweep.loci_seen - since_locus[index]
            since_base[index], since_locus[index] = position, sweep.loci_seen
            current[index] = state
            counts[old] -= 1
            counts[state] += 1
            letters[index] = STATE_LETTERS[state]

    apply(0)
    row_start, row_votes = 0, backbone_votes_at(0)
    for boundary in sorted(position for position in changes if 0 < position < length):
        votes = backbone_votes_at(boundary)
        if votes == row_votes and all(current[index] == state for index, state in changes[boundary]):
            continue
        yield row_start, boundary, row_votes, list(counts), bytes(letters)
        apply(boundary)
        row_start, row_votes = boundary, votes
    yield row_start, length, row_votes, list(counts), bytes(letters)
    for index, state in enumerate(current):
        sweep.bases[index][state] += length - since_base[index]
        sweep.loci[index][state] += sweep.loci_seen - since_locus[index]


def aggregate(
    fai: Path,
    backbone: Path,
    voters: list[Voter],
    backbone_vote: bool,
    sites: TextIO,
    intervals: TextIO,
) -> dict:
    voters = sorted(voters, key=lambda voter: voter.id)
    voter_index = {voter.id: index for index, voter in enumerate(voters)}
    contigs = read_fai(fai)
    sequences = read_fasta(backbone)

    sites.write(f"## schema_version: {SCHEMA_VERSION}\n")
    sites.write("#" + "\t".join([*SITE_COLUMNS, *(f"isolate:{voter.id}" for voter in voters)]) + "\n")
    intervals.write(f"## schema_version: {SCHEMA_VERSION}\n")
    intervals.write(f"## isolates: {','.join(voter.id for voter in voters)}\n")
    intervals.write("#" + "\t".join(INTERVAL_COLUMNS) + "\n")

    by_callable: Counter[int] = Counter()
    by_total: Counter[int] = Counter()
    flag_counts: Counter[str] = Counter()
    spectrum: Counter[int] = Counter()
    site_count = disagreeing = backbone_not_acgt = 0
    base_counts = [[0, 0, 0] for _ in voters]
    locus_counts = [[0, 0, 0] for _ in voters]
    unsupported_loci = [0] * len(voters)
    non_backbone_votes = [0] * len(voters)

    for chrom, length in contigs:
        name, sequence = next(sequences)
        if name != chrom or len(sequence) != length:
            raise ValueError(f"the backbone FASTA does not match its index at {chrom}")
        backbone_not_acgt += sum(len(match.group()) for match in NOT_ACGT.finditer(sequence))

        contig_loci = loci(voters, chrom)
        next_locus = 0
        sweep = Sweep(base_counts, locus_counts)
        for start, end, backbone_votes, counts, letters in interval_rows(chrom, sequence, voters, backbone_vote, sweep):
            size = end - start
            by_callable[counts[CALLABLE]] += size
            by_total[counts[CALLABLE] + backbone_votes] += size
            intervals.write("\t".join([
                chrom, str(start + 1), str(end), str(backbone_votes), str(counts[CALLABLE]),
                str(counts[AMBIGUOUS]), str(counts[UNCALLABLE]), letters.decode("ascii"),
            ]) + "\n")

            while next_locus < len(contig_loci) and contig_loci[next_locus][0] < end:
                locus_start, locus_end, members = contig_loci[next_locus]
                next_locus += 1
                if locus_end <= end:
                    # Inside this row every isolate's state is constant: the sweep counts the locus.
                    locus_letters = letters
                    sweep.loci_seen += 1
                else:
                    # A locus across rows takes every isolate's lowest state over its span.
                    locus_letters = bytes(
                        STATE_LETTERS[voter.masks.get(chrom, Mask()).worst_state(locus_start, locus_end)]
                        for voter in voters
                    )
                    for index, letter in enumerate(locus_letters):
                        locus_counts[index][LETTER_STATES[letter]] += 1
                fields, carriers, flags = site_row(
                    chrom, sequence, locus_start, locus_end, members, voter_index, locus_letters, backbone_vote,
                )
                sites.write("\t".join(fields) + "\n")
                site_count += 1
                flag_counts.update(flags)
                backbone_allele = fields[3]
                voted = {allele for allele in carriers.values() if allele is not None}
                if callable_count_without_records(locus_letters, carriers) or int(fields[4]):
                    voted.add(backbone_allele)
                if len(voted) > 1:
                    disagreeing += 1
                others = [allele for allele in voted if allele != backbone_allele]
                if len(fields[5].split(",")) == 2 and len(others) == 1:
                    spectrum[sum(1 for allele in carriers.values() if allele == others[0])] += 1
                for index, allele in carriers.items():
                    if allele is None:
                        unsupported_loci[index] += 1
                    elif allele != backbone_allele:
                        non_backbone_votes[index] += 1

    per_isolate = {}
    for index, voter in enumerate(voters):
        voted_loci = locus_counts[index][CALLABLE] - unsupported_loci[index]
        per_isolate[voter.id] = {
            "callable_bases": base_counts[index][CALLABLE],
            "ambiguous_bases": base_counts[index][AMBIGUOUS],
            "uncallable_bases": base_counts[index][UNCALLABLE],
            "loci_voted": voted_loci,
            "loci_without_vote": site_count - voted_loci,
            "non_backbone_votes": non_backbone_votes[index],
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "include_backbone_vote": backbone_vote,
        "voters": [voter.id for voter in voters],
        "inputs": {
            "backbone": {"path": backbone.as_posix(), "sha256": sha256_file(backbone)},
            "isolates": {
                voter.id: {
                    "variants": {"path": voter.vcf.as_posix(), "sha256": sha256_file(voter.vcf)},
                    "callable_mask": {"path": voter.mask_path.as_posix(), "sha256": sha256_file(voter.mask_path)},
                }
                for voter in voters
            },
        },
        "genome_length": sum(length for _, length in contigs),
        "backbone_not_acgt_bases": backbone_not_acgt,
        "bases_by_callable_isolates": {str(count): bases for count, bases in sorted(by_callable.items())},
        "bases_by_total_votes": {str(count): bases for count, bases in sorted(by_total.items())},
        "sites": {
            "loci": site_count,
            "disagreeing": disagreeing,
            "flags": {flag: flag_counts[flag] for flag in FLAGS},
        },
        "allele_frequency_spectrum": {str(count): loci for count, loci in sorted(spectrum.items())},
        "isolates": per_isolate,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fai", type=Path, required=True)
    parser.add_argument("--backbone", type=Path, required=True)
    parser.add_argument("--include-backbone-vote", choices=("yes", "no"), required=True)
    parser.add_argument("--voter", nargs=3, action="append", metavar=("ID", "VCF", "MASK"), required=True)
    parser.add_argument("--sites", type=Path, required=True)
    parser.add_argument("--intervals", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    ids = [voter_id for voter_id, _, _ in args.voter]
    if len(set(ids)) != len(ids):
        parser.error("every --voter ID must be distinct")
    voters = [load_voter(voter_id, Path(vcf), Path(mask)) for voter_id, vcf, mask in args.voter]
    for path in (args.sites, args.intervals, args.summary):
        path.parent.mkdir(parents=True, exist_ok=True)
    with args.sites.open("w", encoding="utf-8") as sites, args.intervals.open("w", encoding="utf-8") as intervals:
        summary = aggregate(args.fai, args.backbone, voters, args.include_backbone_vote == "yes", sites, intervals)
    args.summary.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
