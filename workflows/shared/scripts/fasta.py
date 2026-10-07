"""Check the structure of a FASTA file: headers, sequence characters, and lengths.

Used by the input validation of every workflow that reads a FASTA. Kept
dependency-free (standard library only) since these are structural checks,
not sequence analysis.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

_HEADER_ID_PATTERN = re.compile(r"^>(\S+)")
_SEQUENCE_CHARACTERS = re.compile(r"^[ACGTUNRYSWKMBDHV.-]*$", re.IGNORECASE)


@dataclass
class FastaCheck:
    """What `check_fasta` found in one FASTA file.

    Attributes:
        sequence_ids: Every record's identifier, the header up to its first whitespace, in file order.
        sequence_lengths: Each identifier's sequence length in bases, without line breaks.
        errors: Structural problems that make the file unusable; empty when it passed.
        warnings: Problems a caller adds that do not block a run, such as unresolved target bases.
        unresolved_bases: Counts of bases that are not A, C, G, or T.
    """

    sequence_ids: list[str] = field(default_factory=list)
    sequence_lengths: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # Bases that are not A, C, G, or T in any case: N, and every other IUPAC code or gap character.
    unresolved_bases: dict[str, int] = field(default_factory=lambda: {"n": 0, "iupac": 0})


def _count_unresolved(line: str, counts: dict[str, int]) -> None:
    upper = line.upper()
    n = upper.count("N")
    counts["n"] += n
    counts["iupac"] += len(upper) - n - sum(upper.count(base) for base in "ACGT")


def check_fasta(path: Path) -> FastaCheck:
    """Check the structure of a FASTA file and describe its sequences.

    Reads the whole file and collects every problem instead of stopping at the first, so a
    validation report can list them all. Blank lines are ignored, and lowercase (soft-masked)
    bases count as resolved.

    Args:
        path: The FASTA file, UTF-8 encoded.

    Returns:
        The identifiers, lengths, and unresolved-base counts, with an error for a header
        without an identifier, a duplicate identifier, a record without sequence, sequence
        before the first header, a character that is not an IUPAC nucleotide code or gap,
        or a file without records.
    """
    result = FastaCheck()
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
                _count_unresolved(line.strip(), result.unresolved_bases)

    if current_id is not None:
        if current_length == 0:
            result.errors.append(f"sequence '{current_id}' has no sequence data")
        result.sequence_lengths[current_id] = current_length
    if not has_records:
        result.errors.append("file contains no FASTA records")
    return result
