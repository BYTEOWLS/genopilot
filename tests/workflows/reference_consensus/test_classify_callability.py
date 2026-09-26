import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

classify_callability = load_script("classify_callability")


def record(position: int, ref: str, alt: str, ad: str, chrom: str = "c1") -> str:
    return f"{chrom}\t{position}\t{ref}\t{alt}\t{ad}\n"


class ClassifyCallabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        (self.root / "backbone.fasta.fai").write_text("c1\t10\t4\t10\t11\nc2\t3\t20\t3\t4\n", encoding="utf-8")

    def run_script(self, records: str) -> tuple[list[list[str]], list[list[str]], dict]:
        paths = {name: self.root / name for name in ("mask.bed", "consensus-mask.bed", "callability.json")}
        stdin = sys.stdin
        sys.stdin = io.StringIO(records)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = classify_callability.main([
                    "--fai", str(self.root / "backbone.fasta.fai"),
                    "--min-depth", "10", "--min-allele-fraction", "0.8",
                    "--mask", str(paths["mask.bed"]),
                    "--consensus-mask", str(paths["consensus-mask.bed"]),
                    "--summary", str(paths["callability.json"]),
                ])
        finally:
            sys.stdin = stdin
        self.assertEqual(exit_code, 0)

        def rows(path: Path) -> list[list[str]]:
            return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines()]

        return rows(paths["mask.bed"]), rows(paths["consensus-mask.bed"]), json.loads(
            paths["callability.json"].read_text(encoding="utf-8"))

    def states(self, mask: list[list[str]], chrom: str = "c1") -> str:
        """One letter per base: C(allable), A(mbiguous), U(ncallable)."""
        return "".join(
            row[3][0].upper() * (int(row[2]) - int(row[1])) for row in mask if row[0] == chrom
        )

    def test_classifies_depth_and_allele_fraction_per_position(self) -> None:
        mask, consensus_mask, summary = self.run_script(
            record(1, "A", ".", "12")          # callable reference
            + record(2, "C", "T", "1,11")      # callable alternative (11/12)
            + record(3, "G", "T", "6,6")       # ambiguous: enough reads, no winner
            + record(4, "T", ".", "9")         # too few reads
            + record(5, "A", ".", ".")         # no usable allele depths
            + record(6, "C", "A,G", "0,9,1")   # multiallelic, 9/10 wins
            # 7..10 have no record: no usable read covers them
        )
        self.assertEqual(self.states(mask), "CCAUUCUUUU")
        self.assertEqual(self.states(mask, "c2"), "UUU")
        self.assertEqual(consensus_mask, [["c1", "2", "5"], ["c1", "6", "10"], ["c2", "0", "3"]])
        self.assertEqual(summary["bases"], {"callable": 3, "ambiguous": 1, "uncallable": 9})
        self.assertEqual(summary["contigs"]["c1"]["callable"], 3)
        self.assertEqual(summary["thresholds"], {"min_depth": 10, "min_allele_fraction": 0.8})

    def test_a_callable_deletion_makes_the_bases_it_removes_callable(self) -> None:
        mask, _, _ = self.run_script(
            "".join(record(position, "A", ".", "20") for position in (1, 2, 6, 7))
            + record(2, "ATCC", "A", "0,20")
            + "".join(record(position, "A", ".", "0") for position in (3, 4, 5))
        )
        self.assertEqual(self.states(mask), "CCCCCCCUUU")

    def test_an_ambiguous_indel_marks_the_bases_it_spans(self) -> None:
        mask, _, _ = self.run_script(
            "".join(record(position, "A", ".", "20") for position in range(1, 11))
            + record(2, "ATC", "A", "10,10")    # half the reads carry the deletion
            + record(8, "G", "GTT", "11,9")     # an insertion at 9/20
        )
        self.assertEqual(self.states(mask), "CAAACCCACC")

    def test_a_minor_indel_allele_is_noise_and_changes_nothing(self) -> None:
        mask, _, _ = self.run_script(
            "".join(record(position, "A", ".", "20") for position in range(1, 11))
            + record(4, "AT", "A", "18,2")
            + record(6, "A", "AT", "12,1")      # below the minimum depth for indels as well
        )
        self.assertEqual(self.states(mask), "CCCCCCCCCC")

    def test_intervals_cover_every_base_in_backbone_order(self) -> None:
        mask, _, _ = self.run_script(record(5, "A", ".", "30", chrom="c2") + record(10, "A", ".", "30"))
        self.assertEqual([row[0] for row in mask], ["c1", "c1", "c2"])
        self.assertEqual(sum(int(row[2]) - int(row[1]) for row in mask), 13)


if __name__ == "__main__":
    unittest.main()
