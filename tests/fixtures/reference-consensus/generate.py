#!/usr/bin/env python3
"""Generates the synthetic reference-consensus fixtures in this directory.

Everything here is simulated from a fixed seed, so rerunning the script
reproduces the committed files byte for byte:

  backbone.fasta           two random contigs; chr2 repeats 600 bp of chr1
  reads/<isolate>/*.fastq.gz  paired Illumina reads of three isolates
  expected.json            the truth each isolate was simulated from

Isolates are simulated in backbone coordinates: each backbone position
carries the isolate's allele there (a base, a longer string for an
insertion, an empty string for a deletion), fragments are cut from that
token list, and reads are taken from both fragment ends. See README.md for
the cases each isolate covers.

Only `random.random()` is used, because Python guarantees its sequence for a
seed across versions; the other `random` helpers may change.
"""

from __future__ import annotations

import gzip
import io
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = 20260926
READ_LENGTH = 100
FRAGMENT_MEAN = 300
FRAGMENT_SPREAD = 40
SHORT_FRAGMENT_SHARE = 0.05
ERROR_RATE = 0.002
HIGH_QUALITY = "I"
LOW_QUALITY = "#"
ADAPTER_R1 = "AGATCGGAAGAGCACACGTCTGAACTCCAGTCA"
ADAPTER_R2 = "AGATCGGAAGAGCGTCGTGTAGGGAAAGAGTGT"
COMPLEMENT = str.maketrans("ACGTN", "TGCAN")

CONTIG_LENGTHS = {"chr1": 3000, "chr2": 2400}
# chr2[900:1500] is an exact copy of chr1[300:900] (0-based, end-exclusive).
REPEAT = {"source": ("chr1", 300), "copy": ("chr2", 900), "length": 600}


class Random:
    def __init__(self, seed: int) -> None:
        self._random = random.Random(seed)

    def uniform(self) -> float:
        return self._random.random()

    def below(self, bound: int) -> int:
        return min(int(self._random.random() * bound), bound - 1)

    def base(self, excluding: str = "") -> str:
        choices = [base for base in "ACGT" if base != excluding]
        return choices[self.below(len(choices))]

    def normal(self, mean: float, spread: float) -> float:
        # Irwin-Hall approximation: deterministic and built only on random().
        return mean + spread * (sum(self.uniform() for _ in range(12)) - 6)


def reverse_complement(sequence: str) -> str:
    return sequence.translate(COMPLEMENT)[::-1]


def build_backbone(rng: Random) -> dict[str, str]:
    contigs = {name: "".join(rng.base() for _ in range(length)) for name, length in CONTIG_LENGTHS.items()}
    source_name, source_start = REPEAT["source"]
    copy_name, copy_start = REPEAT["copy"]
    length = REPEAT["length"]
    repeat = contigs[source_name][source_start : source_start + length]
    target = contigs[copy_name]
    contigs[copy_name] = target[:copy_start] + repeat + target[copy_start + length :]
    return contigs


def normalized_variant(contig: str, position: int, ref: str, alt: str) -> dict:
    """Left-aligns an indel given as a 1-based VCF record, as `bcftools norm` would."""
    while len(ref) != len(alt) and position > 1 and ref[-1] == alt[-1]:
        previous = contig[position - 2]
        ref, alt = previous + ref[:-1], previous + alt[:-1]
        position -= 1
    return {"position": position, "ref": ref, "alt": alt}


# Every isolate's planned differences from the backbone, in 1-based backbone coordinates.
# `snp` replaces a base, `insertion` adds bases after an anchor, `deletion` removes bases
# after an anchor, `mixed` gives a share of fragments an alternative base, `low_quality`
# gives every base read at the position a quality below any sensible threshold, and
# `no_coverage` drops every fragment overlapping the span.
ISOLATES = {
    "iso-a": {
        "snps": [("chr1", 1100), ("chr1", 1500), ("chr2", 300)],
        "insertion": ("chr1", 1800, "GAT"),
        "deletion": ("chr1", 2200, 4),
        "mixed": ("chr2", 600, 0.6),
        "low_quality": ("chr2", 1800),
        "no_coverage": ("chr2", 2000, 2150),
    },
    "iso-b": {"snps": [("chr1", 1100), ("chr1", 2500), ("chr2", 400)]},
    "iso-c": {"snps": [("chr1", 1500), ("chr2", 300)]},
}

# One entry per read pair: the isolate, Illumina file sample name and number, the header's
# instrument/run/flowcell, the lanes its records carry (several lanes = a lane-merged file),
# the index barcode, the share of the isolate's coverage, and whether the provider trimmed it.
READ_PAIRS = [
    {"isolate": "iso-a", "sample": "IsoA", "number": 1, "instrument": "SIM01", "run": 7,
     "flowcell": "FCA0001", "lanes": [1, 2], "barcode": "ACGTACGT+TTGCAGCA", "share": 1.0,
     "trimmed": False},
    {"isolate": "iso-b", "sample": "IsoB", "number": 2, "instrument": "SIM01", "run": 7,
     "flowcell": "FCA0001", "lanes": [1], "barcode": "GATCGATC+AACCGGTT", "share": 0.5,
     "trimmed": False},
    {"isolate": "iso-b", "sample": "IsoB", "number": 2, "instrument": "SIM02", "run": 12,
     "flowcell": "FCB0002", "lanes": [3], "barcode": "GATCGATC+AACCGGTT", "share": 0.5,
     "trimmed": True},
    {"isolate": "iso-c", "sample": "IsoC", "number": 3, "instrument": "SIM01", "run": 7,
     "flowcell": "FCA0001", "lanes": [1], "barcode": "CTAGCTAG+GGTTAACC", "share": 0.5,
     "trimmed": False},
    {"isolate": "iso-c", "sample": "IsoC", "number": 4, "instrument": "SIM01", "run": 7,
     "flowcell": "FCA0001", "lanes": [1], "barcode": "TGCATGCA+CCAATTGG", "share": 0.5,
     "trimmed": False},
]
COVERAGE = 30
# Fragments sequenced in both pairs of iso-b (one library) and of iso-c (two libraries).
SHARED_FRAGMENTS = 40


def isolate_tokens(backbone: dict[str, str], plan: dict, rng: Random):
    """Returns per-contig allele tokens, the mixed alternative, and the truth variants."""
    tokens = {name: list(sequence) for name, sequence in backbone.items()}
    variants = []
    for contig, position in plan.get("snps", []):
        ref = backbone[contig][position - 1]
        alt = rng.base(excluding=ref)
        tokens[contig][position - 1] = alt
        variants.append({"contig": contig, "position": position, "ref": ref, "alt": alt, "type": "snp"})
    if "insertion" in plan:
        contig, anchor, inserted = plan["insertion"]
        ref = backbone[contig][anchor - 1]
        tokens[contig][anchor - 1] = ref + inserted
        variants.append({"contig": contig, "type": "insertion",
                         **normalized_variant(backbone[contig], anchor, ref, ref + inserted)})
    if "deletion" in plan:
        contig, anchor, length = plan["deletion"]
        for offset in range(length):
            tokens[contig][anchor + offset] = ""
        ref = backbone[contig][anchor - 1 : anchor + length]
        variants.append({"contig": contig, "type": "deletion",
                         **normalized_variant(backbone[contig], anchor, ref, ref[0])})
    mixed = None
    if "mixed" in plan:
        contig, position, share = plan["mixed"]
        mixed = (contig, position, rng.base(excluding=backbone[contig][position - 1]), share)
    return tokens, variants, mixed


def fragment_sequence(tokens, contig, start, end, mixed, low_quality, rng):
    """Joins a fragment's tokens; returns its sequence and the offsets of low-quality bases."""
    pieces, low_offsets, length = [], [], 0
    for index in range(start, end):
        token = tokens[contig][index]
        position = index + 1
        if mixed and mixed[0] == contig and mixed[1] == position and rng.uniform() < mixed[3]:
            token = mixed[2]
        if low_quality == (contig, position) and token:
            low_offsets.append(length)
        pieces.append(token)
        length += len(token)
    return "".join(pieces), low_offsets


def draw_fragments(plan: dict, count: int, rng: Random) -> list[tuple[str, int, int, bool]]:
    """Draws (contig, start, end, reverse) fragments in backbone coordinates."""
    total = sum(CONTIG_LENGTHS.values())
    fragments = []
    while len(fragments) < count:
        pick = rng.below(total)
        contig = "chr1" if pick < CONTIG_LENGTHS["chr1"] else "chr2"
        if rng.uniform() < SHORT_FRAGMENT_SHARE:
            length = 60 + rng.below(35)
        else:
            length = max(READ_LENGTH + 20, round(rng.normal(FRAGMENT_MEAN, FRAGMENT_SPREAD)))
        start = rng.below(CONTIG_LENGTHS[contig] - length)
        end = start + length
        gap = plan.get("no_coverage")
        if gap and gap[0] == contig and start < gap[2] and end > gap[1] - 1:
            continue
        fragments.append((contig, start, end, rng.uniform() < 0.5))
    return fragments


def with_errors(sequence: str, rng: Random) -> str:
    return "".join(rng.base(excluding=base) if rng.uniform() < ERROR_RATE else base for base in sequence)


def read_mates(sequence: str, low_offsets: list[int], reverse: bool, trimmed: bool, rng: Random):
    """Returns ((r1, q1), (r2, q2)) for a fragment, with adapters where the insert is short."""
    qualities = [HIGH_QUALITY] * len(sequence)
    for offset in low_offsets:
        qualities[offset] = LOW_QUALITY
    forward = (sequence, "".join(qualities))
    backward = (reverse_complement(sequence), "".join(qualities)[::-1])
    first, second = (backward, forward) if reverse else (forward, backward)
    mates = []
    for (bases, quality), adapter in ((first, ADAPTER_R1), (second, ADAPTER_R2)):
        if trimmed:
            keep = min(len(bases), 70 + rng.below(31))
            bases, quality = bases[:keep], quality[:keep]
        else:
            bases = (bases + adapter + "A" * READ_LENGTH)[:READ_LENGTH]
            quality = (quality + HIGH_QUALITY * READ_LENGTH)[:READ_LENGTH]
        mates.append((with_errors(bases, rng), quality))
    return mates


def fastq_bytes(records: list[tuple[str, str, str]]) -> bytes:
    text = "".join(f"{header}\n{bases}\n+\n{quality}\n" for header, bases, quality in records)
    buffer = io.BytesIO()
    # A fixed mtime and no file name make the compressed bytes reproducible.
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0, filename="") as handle:
        handle.write(text.encode("ascii"))
    return buffer.getvalue()


def file_stem(pair: dict, mate: str) -> str:
    lane = "" if len(pair["lanes"]) > 1 else f"_L{pair['lanes'][0]:03d}"
    return f"{pair['sample']}_S{pair['number']}{lane}_{mate}_001.fastq.gz"


def main(output_dir: Path = HERE) -> None:
    rng = Random(SEED)
    backbone = build_backbone(rng)
    (output_dir / "backbone.fasta").write_text(
        "".join(
            f">{name} synthetic backbone contig\n"
            + "".join(sequence[i : i + 60] + "\n" for i in range(0, len(sequence), 60))
            for name, sequence in backbone.items()
        ),
        encoding="ascii",
    )

    expected: dict = {"seed": SEED, "repeat": {
        "source": {"contig": REPEAT["source"][0], "start": REPEAT["source"][1] + 1,
                   "end": REPEAT["source"][1] + REPEAT["length"]},
        "copy": {"contig": REPEAT["copy"][0], "start": REPEAT["copy"][1] + 1,
                 "end": REPEAT["copy"][1] + REPEAT["length"]},
    }, "isolates": {}}
    genome_length = sum(CONTIG_LENGTHS.values())
    for isolate, plan in ISOLATES.items():
        tokens, variants, mixed = isolate_tokens(backbone, plan, rng)
        pairs = [pair for pair in READ_PAIRS if pair["isolate"] == isolate]
        shared = draw_fragments(plan, SHARED_FRAGMENTS, rng) if len(pairs) > 1 else []
        pair_records = []
        for pair_index, pair in enumerate(pairs, start=1):
            count = round(COVERAGE * genome_length * pair["share"] / (2 * READ_LENGTH))
            fragments = draw_fragments(plan, count - len(shared), rng) + shared
            r1_records, r2_records = [], []
            for number, (contig, start, end, reverse) in enumerate(fragments, start=1):
                sequence, low_offsets = fragment_sequence(
                    tokens, contig, start, end, mixed, plan.get("low_quality"), rng)
                (r1, q1), (r2, q2) = read_mates(sequence, low_offsets, reverse, pair["trimmed"], rng)
                lane = pair["lanes"][number % len(pair["lanes"])]
                name = f"@{pair['instrument']}:{pair['run']}:{pair['flowcell']}:{lane}:1101:{number}:{1000 + pair_index}"
                r1_records.append((f"{name} 1:N:0:{pair['barcode']}", r1, q1))
                r2_records.append((f"{name} 2:N:0:{pair['barcode']}", r2, q2))
            directory = output_dir / "reads" / isolate
            directory.mkdir(parents=True, exist_ok=True)
            for mate, records in (("R1", r1_records), ("R2", r2_records)):
                (directory / file_stem(pair, mate)).write_bytes(fastq_bytes(records))
            pair_records.append({
                "r1": f"reads/{isolate}/{file_stem(pair, 'R1')}",
                "r2": f"reads/{isolate}/{file_stem(pair, 'R2')}",
                "trimmed": pair["trimmed"],
                "read_pairs": len(fragments),
                "instrument": pair["instrument"],
                "run": pair["run"],
                "flowcell": pair["flowcell"],
                "lane": pair["lanes"][0] if len(pair["lanes"]) == 1 else None,
                "barcode": pair["barcode"],
            })
        probes = {}
        if mixed:
            probes["ambiguous"] = [{"contig": mixed[0], "position": mixed[1]}]
        uncallable = [{"contig": "chr1", "position": 600}, {"contig": "chr2", "position": 1200}]
        if "low_quality" in plan:
            contig, position = plan["low_quality"]
            uncallable.append({"contig": contig, "position": position})
        if "no_coverage" in plan:
            contig, start, end = plan["no_coverage"]
            uncallable.append({"contig": contig, "position": (start + end) // 2})
        probes["uncallable"] = uncallable
        expected["isolates"][isolate] = {
            "read_pairs": pair_records,
            "shared_fragments": len(shared),
            "variants": variants,
            "probes": probes,
        }
    (output_dir / "expected.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
