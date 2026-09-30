import gzip
import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

aggregate_support = load_script("aggregate_support")

# c1, 1-based:  1 G  2 A  3 T  4 C  5 C  6 T  7 G  8 A  9 C 10 G 11 T 12 A
BACKBONE = {"c1": "GATCCTGACGTA", "c2": "acNNgt"}


def pass_record(position: int, ref: str, alt: str, status: str = "PASS", chrom: str = "c1") -> str:
    return f"{chrom}\t{position}\t.\t{ref}\t{alt}\t.\t{status}\t.\tGT\t1\n"


class AggregateSupportTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.temp_dir = Path(self._tmp.name)
        fasta = "".join(f">{name} description\n{sequence}\n" for name, sequence in BACKBONE.items())
        (self.temp_dir / "backbone.fasta").write_text(fasta, encoding="utf-8")
        (self.temp_dir / "backbone.fasta.fai").write_text(
            "".join(f"{name}\t{len(sequence)}\t0\t0\t0\n" for name, sequence in BACKBONE.items()), encoding="utf-8"
        )
        self.voters: list[str] = []

    def isolate(self, isolate_id: str, records: str = "", mask: dict[str, list[tuple[int, int, str]]] | None = None) -> None:
        """Writes an isolate's VCF and mask; the mask defaults to callable everywhere."""
        with gzip.open(self.temp_dir / f"{isolate_id}.vcf.gz", "wt", encoding="utf-8") as vcf:
            vcf.write("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tsample\n")
            vcf.write(records)
        mask = mask or {}
        lines = []
        for name, sequence in BACKBONE.items():
            for start, end, state in mask.get(name, [(0, len(sequence), "callable")]):
                lines.append(f"{name}\t{start}\t{end}\t{state}\n")
        (self.temp_dir / f"{isolate_id}.bed").write_text("".join(lines), encoding="utf-8")
        self.voters.append(isolate_id)

    def run_script(self, backbone_vote: str = "yes", voters: list[str] | None = None, out: str = "out") -> dict:
        args = [
            "--fai", str(self.temp_dir / "backbone.fasta.fai"),
            "--backbone", str(self.temp_dir / "backbone.fasta"),
            "--include-backbone-vote", backbone_vote,
            "--sites", str(self.temp_dir / out / "sites.tsv"),
            "--intervals", str(self.temp_dir / out / "intervals.tsv"),
            "--summary", str(self.temp_dir / out / "summary.json"),
        ]
        for voter in voters or self.voters:
            args += ["--voter", voter, str(self.temp_dir / f"{voter}.vcf.gz"), str(self.temp_dir / f"{voter}.bed")]
        self.assertEqual(aggregate_support.main(args), 0)
        return json.loads((self.temp_dir / out / "summary.json").read_text(encoding="utf-8"))

    def table(self, name: str, out: str = "out") -> list[dict[str, str]]:
        lines = (self.temp_dir / out / f"{name}.tsv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines[0], "## schema_version: 1")
        header_line = next(line for line in lines if not line.startswith("##"))
        header = header_line.lstrip("#").split("\t")
        return [dict(zip(header, line.split("\t"))) for line in lines if not line.startswith("#")]

    def site(self, start: int) -> dict[str, str]:
        return next(row for row in self.table("sites") if row["start"] == str(start))

    def test_a_callable_isolate_without_a_variant_votes_for_the_backbone(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T"))
        self.isolate("iso-b")
        self.run_script()
        site = self.site(8)
        self.assertEqual((site["alleles"], site["allele_votes"]), ("A,T", "2,1"))
        self.assertEqual((site["isolate:iso-a"], site["isolate:iso-b"]), ("1", "0"))
        self.assertEqual((site["callable_isolates"], site["total_votes"], site["flags"]), ("2", "3", "snp"))

    def test_missing_evidence_is_never_a_vote(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T"))
        self.isolate("iso-b", mask={"c1": [(0, 5, "callable"), (5, 7, "ambiguous"), (7, 12, "uncallable")]})
        summary = self.run_script()
        site = self.site(8)
        self.assertEqual((site["alleles"], site["allele_votes"]), ("A,T", "1,1"))
        self.assertEqual(site["isolate:iso-b"], "uncallable")

        c1 = [row for row in self.table("intervals") if row["chrom"] == "c1"]
        self.assertEqual(
            [(row["start"], row["end"], row["callable_isolates"], row["ambiguous_isolates"],
              row["uncallable_isolates"], row["states"]) for row in c1],
            [("1", "5", "2", "0", "0", "cc"), ("6", "7", "1", "1", "0", "ca"), ("8", "12", "1", "0", "1", "cu")],
        )
        self.assertIn("## isolates: iso-a,iso-b", (self.temp_dir / "out" / "intervals.tsv").read_text(encoding="utf-8"))
        self.assertEqual(summary["isolates"]["iso-b"]["ambiguous_bases"], 2)
        self.assertEqual(summary["isolates"]["iso-b"]["loci_without_vote"], 1)

    def test_filtered_records_are_not_evidence(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T", status="LowDepth"))
        summary = self.run_script()
        self.assertEqual(self.table("sites"), [])
        self.assertEqual(summary["sites"]["loci"], 0)

    def test_an_ambiguous_isolate_casts_no_vote_at_a_locus(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T"))
        self.isolate("iso-b", mask={"c1": [(0, 7, "callable"), (7, 8, "ambiguous"), (8, 12, "callable")]})
        self.run_script(backbone_vote="no")
        site = self.site(8)
        self.assertEqual((site["alleles"], site["allele_votes"], site["backbone_votes"]), ("A,T", "0,1", "0"))
        self.assertEqual(site["isolate:iso-b"], "ambiguous")

    def test_a_pass_variant_on_a_base_the_mask_calls_ambiguous_casts_no_vote(self) -> None:
        # A SNP inside an ambiguous indel's span: the mask, like the isolate FASTA's N, wins.
        self.isolate("iso-a", pass_record(8, "A", "T"), mask={"c1": [(0, 6, "callable"), (6, 9, "ambiguous"), (9, 12, "callable")]})
        self.run_script()
        site = self.site(8)
        self.assertEqual((site["alleles"], site["allele_votes"], site["isolate:iso-a"]), ("A", "1", "ambiguous"))

    def test_a_multiallelic_snp_is_one_ballot(self) -> None:
        self.isolate("iso-a", pass_record(9, "C", "A"))
        self.isolate("iso-b", pass_record(9, "C", "T"))
        self.isolate("iso-c", pass_record(9, "C", "T"))
        self.isolate("iso-d")
        self.run_script()
        site = self.site(9)
        self.assertEqual((site["alleles"], site["allele_votes"]), ("C,T,A", "2,2,1"))
        self.assertEqual(site["flags"], "snp,multiallelic")
        self.assertEqual([site[f"isolate:iso-{name}"] for name in "abcd"], ["2", "1", "1", "0"])

    def test_identical_normalized_indels_are_one_allele(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A"))
        self.isolate("iso-b", pass_record(2, "ATCCT", "A"))
        self.isolate("iso-c")
        self.run_script()
        site = self.site(2)
        self.assertEqual((site["end"], site["alleles"], site["allele_votes"]), ("6", "ATCCT,A", "2,2"))
        self.assertEqual(site["flags"], "indel")

    def test_a_snp_inside_another_isolates_deletion_competes_in_one_locus(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A"))
        self.isolate("iso-b")
        self.isolate("iso-c", pass_record(4, "C", "G"))
        self.run_script()
        sites = self.table("sites")
        self.assertEqual(len(sites), 1)
        site = sites[0]
        self.assertEqual((site["start"], site["end"]), ("2", "6"))
        self.assertEqual((site["alleles"], site["allele_votes"]), ("ATCCT,A,ATGCT", "2,1,1"))
        self.assertEqual(site["flags"], "indel,multiallelic,overlapping,competing_indel")
        self.assertEqual([site[f"isolate:iso-{name}"] for name in "abc"], ["1", "0", "2"])

    def test_partially_overlapping_deletions_share_the_union_of_their_spans(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCC", "A"))
        self.isolate("iso-b", pass_record(4, "CCTG", "C"))
        self.run_script(backbone_vote="no")
        site = self.site(2)
        self.assertEqual((site["end"], site["backbone_allele"]), ("7", "ATCCTG"))
        self.assertEqual((site["alleles"], site["allele_votes"]), ("ATCCTG,ATC,ATG", "0,1,1"))

    def test_an_insertion_and_a_snp_at_one_anchor_compete(self) -> None:
        self.isolate("iso-a", pass_record(7, "G", "GGAT"))
        self.isolate("iso-b", pass_record(7, "G", "T"))
        self.run_script()
        site = self.site(7)
        self.assertEqual((site["end"], site["alleles"], site["allele_votes"]), ("7", "G,GGAT,T", "1,1,1"))
        self.assertIn("competing_indel", site["flags"])

    def test_records_that_cannot_be_applied_are_unsupported(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATC", "A") + pass_record(3, "T", "G"))
        self.isolate("iso-b", pass_record(9, "C", "<DEL>"))
        self.run_script()
        overlapping = self.site(2)
        self.assertEqual(overlapping["isolate:iso-a"], "unsupported")
        self.assertIn("unsupported", overlapping["flags"])
        self.assertEqual(self.site(9)["isolate:iso-b"], "unsupported")
        self.assertEqual(self.site(9)["alleles"], "C")

    def test_a_snp_and_an_insertion_at_one_position_of_one_isolate_are_one_allele(self) -> None:
        self.isolate("iso-a", pass_record(7, "G", "GGAT") + pass_record(7, "G", "T"))
        self.isolate("iso-b")
        self.run_script()
        site = self.site(7)
        self.assertEqual((site["alleles"], site["allele_votes"], site["isolate:iso-a"]), ("G,TGAT", "2,1", "1"))
        self.assertEqual(site["flags"], "indel")

    def test_a_snp_at_a_deletions_anchor_of_one_isolate_is_one_allele(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A") + pass_record(2, "A", "G"))
        self.run_script()
        site = self.site(2)
        self.assertEqual((site["end"], site["alleles"], site["isolate:iso-a"]), ("6", "ATCCT,G", "1"))
        self.assertEqual(site["flags"], "indel")

    def test_two_snps_at_one_position_of_one_isolate_are_unsupported(self) -> None:
        self.isolate("iso-a", pass_record(9, "C", "A") + pass_record(9, "C", "T"))
        self.run_script()
        self.assertEqual(self.site(9)["isolate:iso-a"], "unsupported")

    def test_flags_describe_the_records_of_isolates_without_a_vote(self) -> None:
        # Three records at one position cannot be combined, so iso-a casts no vote at its insertion.
        self.isolate("iso-a", pass_record(7, "G", "GGAT") + pass_record(7, "G", "T") + pass_record(7, "G", "C"))
        self.isolate("iso-b")
        self.run_script()
        site = self.site(7)
        self.assertEqual((site["alleles"], site["isolate:iso-a"]), ("G", "unsupported"))
        self.assertEqual(site["flags"], "indel,unsupported")

    def test_overlap_needs_variants_of_different_isolates(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATC", "A") + pass_record(3, "T", "G"))
        self.run_script()
        self.assertEqual(self.site(2)["flags"], "indel,unsupported")

    def test_without_the_backbone_vote_positions_without_callable_isolates_have_no_vote(self) -> None:
        self.isolate("iso-a", mask={"c1": [(0, 4, "uncallable"), (4, 12, "callable")]})
        summary = self.run_script(backbone_vote="no")
        self.assertEqual(summary["bases_by_total_votes"], {"0": 4, "1": 8 + len(BACKBONE["c2"])})
        self.assertFalse(summary["include_backbone_vote"])
        self.assertTrue(all(row["backbone_votes"] == "0" for row in self.table("intervals")))

    def test_the_backbone_casts_no_vote_where_its_base_is_not_acgt(self) -> None:
        self.isolate("iso-a")
        summary = self.run_script()
        c2 = [(row["start"], row["end"], row["backbone_votes"]) for row in self.table("intervals") if row["chrom"] == "c2"]
        self.assertEqual(c2, [("1", "2", "1"), ("3", "4", "0"), ("5", "6", "1")])
        self.assertEqual(summary["backbone_not_acgt_bases"], 2)
        self.assertEqual(summary["bases_by_total_votes"], {"1": 2, "2": 16})

    def test_soft_masked_backbone_bases_are_compared_uppercase(self) -> None:
        self.isolate("iso-a", pass_record(5, "G", "A", chrom="c2"))
        self.run_script()
        site = next(row for row in self.table("sites") if row["chrom"] == "c2")
        self.assertEqual((site["alleles"], site["allele_votes"]), ("G,A", "1,1"))

    def test_one_isolate_is_enough(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T"))
        summary = self.run_script()
        self.assertEqual(summary["voters"], ["iso-a"])
        self.assertEqual(summary["allele_frequency_spectrum"], {"1": 1})

    def test_the_summary_counts_sites_and_the_allele_frequency_spectrum(self) -> None:
        self.isolate("iso-a", pass_record(8, "A", "T") + pass_record(11, "T", "C"))
        self.isolate("iso-b", pass_record(8, "A", "T"))
        self.isolate("iso-c", pass_record(11, "T", "G"))
        summary = self.run_script()
        self.assertEqual(summary["sites"]["loci"], 2)
        self.assertEqual(summary["sites"]["disagreeing"], 2)
        self.assertEqual(summary["sites"]["flags"]["snp"], 2)
        self.assertEqual(summary["sites"]["flags"]["multiallelic"], 1)
        self.assertEqual(summary["allele_frequency_spectrum"], {"2": 1})
        self.assertEqual(summary["isolates"]["iso-a"]["non_backbone_votes"], 2)
        self.assertEqual(summary["isolates"]["iso-a"]["callable_bases"], 18)
        self.assertEqual(set(summary["inputs"]["isolates"]), {"iso-a", "iso-b", "iso-c"})

    def test_every_isolates_bases_add_up_to_the_genome(self) -> None:
        # Bases the mask leaves out are uncallable; c2 is callable for iso-a by default.
        self.isolate("iso-a", mask={"c1": [(0, 2, "callable"), (5, 9, "ambiguous")]})
        self.isolate("iso-b", mask={"c1": [(0, 12, "uncallable")], "c2": [(2, 6, "callable")]})
        summary = self.run_script()

        def bases(isolate: str) -> tuple[int, int, int]:
            counts = summary["isolates"][isolate]
            return counts["callable_bases"], counts["ambiguous_bases"], counts["uncallable_bases"]

        self.assertEqual(bases("iso-a"), (8, 4, 6))
        self.assertEqual(bases("iso-b"), (4, 0, 14))
        states = [(row["chrom"], row["start"], row["end"], row["states"]) for row in self.table("intervals")]
        self.assertEqual(states, [
            ("c1", "1", "2", "cu"), ("c1", "3", "5", "uu"), ("c1", "6", "9", "au"), ("c1", "10", "12", "uu"),
            ("c2", "1", "2", "cu"), ("c2", "3", "4", "cc"), ("c2", "5", "6", "cc"),
        ])

    def test_the_output_does_not_depend_on_voter_order_or_repetition(self) -> None:
        self.isolate("iso-a", pass_record(2, "ATCCT", "A"))
        self.isolate("iso-b", mask={"c1": [(0, 3, "uncallable"), (3, 12, "callable")]})
        self.isolate("iso-c", pass_record(4, "C", "G") + pass_record(9, "C", "T"))
        self.run_script(out="first")
        self.run_script(voters=["iso-c", "iso-a", "iso-b"], out="second")
        self.run_script(voters=["iso-b", "iso-c", "iso-a"], out="third")
        for name in ("sites.tsv", "intervals.tsv", "summary.json"):
            first = (self.temp_dir / "first" / name).read_text(encoding="utf-8")
            for out in ("second", "third"):
                with self.subTest(file=name, run=out):
                    self.assertEqual((self.temp_dir / out / name).read_text(encoding="utf-8").replace(out, "first"), first)


if __name__ == "__main__":
    unittest.main()
