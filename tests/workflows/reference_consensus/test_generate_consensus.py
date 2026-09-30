import gzip
import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script
from .test_aggregate_support import BACKBONE, pass_record

aggregate_support = load_script("aggregate_support")
generate_consensus = load_script("generate_consensus")

SITE_HEADER = "#chrom\tstart\tend\tbackbone_allele\tbackbone_votes\talleles\tallele_votes\tcallable_isolates\ttotal_votes\tflags\n"
INTERVAL_HEADER = "#chrom\tstart\tend\tbackbone_votes\tcallable_isolates\tambiguous_isolates\tuncallable_isolates\tstates\n"


class GenerateConsensusTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.temp_dir = Path(self._tmp.name)
        self.write_backbone(BACKBONE)
        self.voters: list[str] = []

    def write_backbone(self, contigs: dict[str, str]) -> None:
        fasta = "".join(f">{name} description\n{sequence}\n" for name, sequence in contigs.items())
        (self.temp_dir / "backbone.fasta").write_text(fasta, encoding="utf-8")
        (self.temp_dir / "backbone.fasta.fai").write_text(
            "".join(f"{name}\t{len(sequence)}\t0\t0\t0\n" for name, sequence in contigs.items()), encoding="utf-8"
        )

    def isolate(self, isolate_id: str, records: str = "", mask: dict[str, list[tuple[int, int, str]]] | None = None) -> None:
        """Writes an isolate's VCF and mask; the mask defaults to callable everywhere."""
        with gzip.open(self.temp_dir / f"{isolate_id}.vcf.gz", "wt", encoding="utf-8") as vcf:
            vcf.write("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tsample\n")
            vcf.write(records)
        lines = []
        for name, sequence in BACKBONE.items():
            for start, end, state in (mask or {}).get(name, [(0, len(sequence), "callable")]):
                lines.append(f"{name}\t{start}\t{end}\t{state}\n")
        (self.temp_dir / f"{isolate_id}.bed").write_text("".join(lines), encoding="utf-8")
        self.voters.append(isolate_id)

    def aggregate(self, backbone_vote: str = "yes") -> None:
        args = [
            "--fai", str(self.temp_dir / "backbone.fasta.fai"),
            "--backbone", str(self.temp_dir / "backbone.fasta"),
            "--include-backbone-vote", backbone_vote,
            "--sites", str(self.temp_dir / "support-sites.tsv"),
            "--intervals", str(self.temp_dir / "support-intervals.tsv"),
            "--summary", str(self.temp_dir / "support-summary.json"),
        ]
        for voter in self.voters:
            args += ["--voter", voter, str(self.temp_dir / f"{voter}.vcf.gz"), str(self.temp_dir / f"{voter}.bed")]
        self.assertEqual(aggregate_support.main(args), 0)

    def write_support(self, sites: list[str], intervals: list[str]) -> None:
        """Hand-written support tables, for vote counts that are tedious to simulate."""
        (self.temp_dir / "support-sites.tsv").write_text(
            "## schema_version: 1\n" + SITE_HEADER + "".join(row + "\n" for row in sites), encoding="utf-8")
        (self.temp_dir / "support-intervals.tsv").write_text(
            "## schema_version: 1\n## isolates: \n" + INTERVAL_HEADER + "".join(row + "\n" for row in intervals),
            encoding="utf-8")
        (self.temp_dir / "support-summary.json").write_text(
            json.dumps({"include_backbone_vote": True, "voters": []}), encoding="utf-8")

    def generate(self, method: str = "strict-majority", minimum: int = 0, snp: str = "n", out: str = "out") -> dict:
        self.assertEqual(generate_consensus.main([
            "--fai", str(self.temp_dir / "backbone.fasta.fai"),
            "--backbone", str(self.temp_dir / "backbone.fasta"),
            "--sites", str(self.temp_dir / "support-sites.tsv"),
            "--intervals", str(self.temp_dir / "support-intervals.tsv"),
            "--support-summary", str(self.temp_dir / "support-summary.json"),
            "--voting-method", method,
            "--min-callable-isolates", str(minimum),
            "--unresolved-snp", snp,
            "--fasta", str(self.temp_dir / out / "consensus.fasta"),
            "--consensus-sites", str(self.temp_dir / out / "consensus-sites.tsv"),
            "--summary", str(self.temp_dir / out / "summary.json"),
        ]), 0)
        return json.loads((self.temp_dir / out / "summary.json").read_text(encoding="utf-8"))

    def fasta(self, out: str = "out") -> dict[str, str]:
        records: dict[str, str] = {}
        name = ""
        for line in (self.temp_dir / out / "consensus.fasta").read_text(encoding="utf-8").splitlines():
            if line.startswith(">"):
                name = line[1:]
                records[name] = ""
            else:
                self.assertLessEqual(len(line), 60)
                records[name] += line
        return records

    def rows(self, out: str = "out") -> list[dict[str, str]]:
        lines = (self.temp_dir / out / "consensus-sites.tsv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines[0], "## schema_version: 1")
        header = next(line for line in lines if not line.startswith("##")).lstrip("#").split("\t")
        return [dict(zip(header, line.split("\t"))) for line in lines if not line.startswith("#")]

    def row(self, chrom: str, start: int, out: str = "out") -> dict[str, str]:
        return next(row for row in self.rows(out) if row["chrom"] == chrom and row["start"] == str(start))

    def test_the_documented_voting_examples(self) -> None:
        # One locus at c1:9, backbone C; (alleles, votes) -> (strict majority, plurality, IUPAC when unresolved).
        self.write_backbone({"c1": BACKBONE["c1"]})
        examples = [
            ("C,A", "4,6", ("A", "."), ("A", "."), None),
            ("C,A", "5,5", (None, "tie"), (None, "tie"), "M"),
            ("C,A,G", "3,4,3", (None, "no_majority"), ("A", "."), "V"),
            ("C,A,G", "4,4,2", (None, "tie"), (None, "tie"), "V"),
        ]
        for alleles, votes, strict, plurality, code in examples:
            total = sum(int(count) for count in votes.split(","))
            self.write_support(
                [f"c1\t9\t9\tC\t1\t{alleles}\t{votes}\t{total - 1}\t{total}\tsnp"],
                [f"c1\t1\t12\t1\t{total - 1}\t0\t0\t."],
            )
            for method, (allele, reason) in (("strict-majority", strict), ("plurality", plurality)):
                with self.subTest(votes=votes, method=method):
                    self.generate(method=method)
                    site = self.row("c1", 9)
                    self.assertEqual((site["allele"], site["reason"]), (allele or ".", reason))
                    self.assertEqual(site["status"], "selected" if allele else "unresolved")
                    self.assertEqual(self.fasta()["c1"][8], allele or "N")
                    self.generate(method=method, snp="iupac", out="iupac")
                    self.assertEqual(self.fasta("iupac")["c1"][8], allele or code)

    def test_a_multiallelic_snp_tie_is_n_or_the_code_of_every_voted_allele(self) -> None:
        self.isolate("iso-a", pass_record(9, "C", "A"))
        self.isolate("iso-b", pass_record(9, "C", "T"))
        self.isolate("iso-c", pass_record(9, "C", "T"))
        self.isolate("iso-d")
        self.aggregate()  # C=2 (backbone, iso-d), T=2, A=1
        for method in ("strict-majority", "plurality"):
            with self.subTest(method=method):
                summary = self.generate(method=method)
                self.assertEqual(self.fasta()["c1"][8], "N")
                self.assertEqual(self.row("c1", 9)["reason"], "tie")
                self.assertEqual(summary["loci_by_flag"]["multiallelic"]["unresolved"]["tie"], 1)
                self.assertEqual(summary["bases"]["n"]["tie"], 1)
                summary = self.generate(method=method, snp="iupac")
                self.assertEqual(self.fasta()["c1"][8], "H")  # A, C, or T
                self.assertEqual(self.row("c1", 9)["written"], "H")
                self.assertEqual(summary["bases"]["iupac"], 1)

    def test_a_selected_deletion_shifts_the_consensus_coordinates(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A") + pass_record(9, "C", "T"))
        self.isolate("iso-b", pass_record(2, "ATCCT", "A") + pass_record(9, "C", "T"))
        self.isolate("iso-c")
        self.aggregate(backbone_vote="no")
        summary = self.generate()
        self.assertEqual(self.fasta()["c1"], "GAGATGTA")
        deletion, snp = self.row("c1", 2), self.row("c1", 9)
        self.assertEqual((deletion["end"], deletion["consensus_start"], deletion["consensus_end"]), ("6", "2", "2"))
        self.assertEqual((deletion["status"], deletion["allele"], deletion["written"]), ("selected", "A", "A"))
        self.assertEqual((snp["consensus_start"], snp["consensus_end"], snp["written"]), ("5", "5", "T"))
        self.assertEqual(summary["contigs"][0], {"name": "c1", "backbone_length": 12, "consensus_length": 8})
        self.assertEqual(summary["loci"]["changed"], 2)

    def test_a_selected_insertion_lengthens_the_consensus(self) -> None:
        self.isolate("iso-a", pass_record(7, "G", "GGAT"))
        self.isolate("iso-b", pass_record(7, "G", "GGAT"))
        self.isolate("iso-c")
        self.aggregate(backbone_vote="no")
        self.generate()
        self.assertEqual(self.fasta()["c1"], "GATCCTGGATACGTA")
        site = self.row("c1", 7)
        self.assertEqual((site["consensus_start"], site["consensus_end"], site["written"]), ("7", "10", "GGAT"))
        self.assertEqual(self.row("c1", 7)["flags"], "indel")

    def test_an_unresolved_indel_is_n_over_its_backbone_span_even_with_iupac(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A"))
        self.isolate("iso-b")
        self.aggregate(backbone_vote="no")  # ATCCT=1, A=1
        summary = self.generate(method="plurality", snp="iupac")
        self.assertEqual(self.fasta()["c1"], "GNNNNNGACGTA")
        site = self.row("c1", 2)
        self.assertEqual((site["status"], site["reason"], site["written"]), ("unresolved", "tie", "NNNNN"))
        self.assertEqual((site["consensus_start"], site["consensus_end"]), ("2", "6"))
        self.assertEqual(summary["loci_by_flag"]["indel"]["unresolved"]["tie"], 1)
        self.assertEqual(summary["bases"], {
            "backbone_only": 0, "iupac": 0,
            "n": {"tie": 5, "no_majority": 0, "no_votes": 0, "few_callable": 0, "backbone_not_acgt": 2},
        })

    def test_positions_without_any_vote_are_n(self) -> None:
        self.isolate("iso-a", mask={"c1": [(0, 4, "uncallable"), (4, 12, "callable")]})
        self.aggregate(backbone_vote="no")
        summary = self.generate()
        self.assertEqual(self.fasta()["c1"], "NNNNCTGACGTA")
        region = self.row("c1", 1)
        self.assertEqual(
            (region["end"], region["kind"], region["status"], region["reason"], region["total_votes"]),
            ("4", "region", "unresolved", "no_votes", "0"),
        )
        self.assertEqual(summary["bases"]["n"]["no_votes"], 4)
        self.assertEqual(summary["loci"]["selected"], 0)

    def test_a_backbone_only_region_follows_the_minimum_of_callable_isolates(self) -> None:
        self.isolate("iso-a", pass_record(9, "C", "T"), mask={"c1": [(0, 4, "uncallable"), (4, 12, "callable")]})
        self.aggregate()
        summary = self.generate()
        self.assertEqual(self.fasta()["c1"][:4], "GATC")
        self.assertEqual(summary["bases"]["backbone_only"], 4)
        self.assertEqual(self.row("c1", 9)["reason"], "tie")  # C (backbone) and T (iso-a)

        summary = self.generate(minimum=1)
        self.assertEqual(self.fasta()["c1"][:4], "NNNN")
        self.assertEqual((self.row("c1", 1)["reason"], self.row("c1", 1)["end"]), ("few_callable", "4"))
        self.assertEqual(summary["bases"]["backbone_only"], 0)
        self.assertEqual(summary["bases"]["n"]["few_callable"], 4)

        summary = self.generate(minimum=2)
        self.assertEqual(self.fasta(), {"c1": "N" * 12, "c2": "N" * 6})
        self.assertEqual(self.row("c1", 9)["reason"], "few_callable")
        self.assertEqual(summary["loci"]["unresolved"]["few_callable"], 1)

    def test_backbone_gaps_stay_n_and_soft_masking_is_dropped(self) -> None:
        self.isolate("iso-a", mask={"c2": [(0, 6, "uncallable")]})
        self.aggregate()
        self.generate()
        self.assertEqual(self.fasta()["c2"], "ACNNGT")
        self.assertEqual(self.row("c2", 3)["reason"], "no_votes")  # the backbone does not vote on its gap

        self.isolate("iso-b")
        self.aggregate()
        summary = self.generate()
        self.assertEqual(self.fasta()["c2"], "ACNNGT")  # iso-b's votes for the gap cannot name a base
        self.assertEqual(summary["bases"]["n"]["backbone_not_acgt"], 2)

    def test_the_consensus_keeps_the_backbone_sequence_ids_and_order(self) -> None:
        self.isolate("iso-a")
        self.aggregate()
        self.generate()
        self.assertEqual(list(self.fasta()), ["c1", "c2"])

    def test_the_output_is_reproducible(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A"))
        self.isolate("iso-b", pass_record(4, "C", "G"), mask={"c2": [(0, 3, "ambiguous"), (3, 6, "callable")]})
        self.isolate("iso-c", pass_record(9, "C", "T"))
        self.aggregate(backbone_vote="no")
        self.generate(out="first")
        self.generate(out="second")
        for name in ("consensus.fasta", "consensus-sites.tsv", "summary.json"):
            with self.subTest(file=name):
                first = (self.temp_dir / "first" / name).read_text(encoding="utf-8")
                self.assertEqual((self.temp_dir / "second" / name).read_text(encoding="utf-8").replace("second", "first"), first)

    def test_reads_bgzip_compressed_support_tables(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T"))
        self.aggregate(backbone_vote="no")
        for name in ("support-sites", "support-intervals"):
            plain = self.temp_dir / f"{name}.tsv"
            with gzip.open(self.temp_dir / f"{name}.tsv.gz", "wt", encoding="utf-8") as compressed:
                compressed.write(plain.read_text(encoding="utf-8"))
            plain.write_text("not the table\n", encoding="utf-8")
        self.assertEqual(generate_consensus.main([
            "--fai", str(self.temp_dir / "backbone.fasta.fai"), "--backbone", str(self.temp_dir / "backbone.fasta"),
            "--sites", str(self.temp_dir / "support-sites.tsv.gz"),
            "--intervals", str(self.temp_dir / "support-intervals.tsv.gz"),
            "--support-summary", str(self.temp_dir / "support-summary.json"),
            "--voting-method", "strict-majority", "--min-callable-isolates", "0", "--unresolved-snp", "n",
            "--fasta", str(self.temp_dir / "out" / "consensus.fasta"),
            "--consensus-sites", str(self.temp_dir / "out" / "consensus-sites.tsv"),
            "--summary", str(self.temp_dir / "out" / "summary.json"),
        ]), 0)
        self.assertEqual(self.fasta()["c1"][7], "T")

    def test_refuses_support_tables_that_do_not_match_the_backbone(self) -> None:
        self.write_backbone({"c1": BACKBONE["c1"]})
        self.write_support(["c1\t9\t9\tG\t1\tG,A\t1,1\t1\t2\tsnp"], ["c1\t1\t12\t1\t1\t0\t0\t."])
        with self.assertRaises(ValueError):
            self.generate()
        self.write_support([], ["c1\t1\t10\t1\t1\t0\t0\t."])
        with self.assertRaises(ValueError):
            self.generate()


if __name__ == "__main__":
    unittest.main()
