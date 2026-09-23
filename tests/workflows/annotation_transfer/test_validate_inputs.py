import json
import tempfile
import unittest
from pathlib import Path

from ._load import FIXTURES_DIR, load_script

validate_inputs = load_script("validate_inputs")


class ParseFastaTests(unittest.TestCase):
    def test_reports_sequence_ids_and_lengths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nACGT\nACGT\n>b\nNNNN\n", encoding="utf-8")

            result = validate_inputs.parse_fasta(path)

            self.assertEqual(result.sequence_ids, ["a", "b"])
            self.assertEqual(result.sequence_lengths, {"a": 8, "b": 4})
            self.assertEqual(result.errors, [])

    def test_flags_duplicate_ids_and_empty_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nACGT\n>a\n>b\nACGT\n", encoding="utf-8")

            result = validate_inputs.parse_fasta(path)

            self.assertTrue(any("duplicate sequence id 'a'" in error for error in result.errors))
            self.assertTrue(any("no sequence data" in error for error in result.errors))

    def test_flags_non_iupac_characters(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nACGTZZZ\n", encoding="utf-8")

            result = validate_inputs.parse_fasta(path)

            self.assertTrue(any("non-IUPAC characters" in error for error in result.errors))

    def test_flags_empty_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text("", encoding="utf-8")

            result = validate_inputs.parse_fasta(path)

            self.assertIn("file contains no FASTA records", result.errors)


class ParseGff3Tests(unittest.TestCase):
    def _write(self, tmp: str, content: str) -> Path:
        path = Path(tmp) / "in.gff3"
        path.write_text(content, encoding="utf-8")
        return path

    def test_accepts_a_well_formed_multi_exon_gene(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\n"
                "chr1\tf\tgene\t1\t100\t.\t+\t.\tID=g1\n"
                "chr1\tf\tmRNA\t1\t100\t.\t+\t.\tID=m1;Parent=g1\n"
                "chr1\tf\texon\t1\t50\t.\t+\t.\tID=e1;Parent=m1\n"
                "chr1\tf\texon\t60\t100\t.\t+\t.\tID=e2;Parent=m1\n"
                "chr1\tf\tCDS\t1\t50\t.\t+\t0\tID=c1;Parent=m1\n"
                "chr1\tf\tCDS\t60\t100\t.\t+\t0\tID=c1;Parent=m1\n",
            )

            result = validate_inputs.parse_gff3(path)

            self.assertEqual(result.errors, [])
            self.assertEqual(result.feature_count, 6)
            self.assertEqual(result.seqids, {"chr1"})

    def test_rejects_missing_version_pragma(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, "chr1\tf\tgene\t1\t10\t.\t+\t.\tID=g1\n")

            result = validate_inputs.parse_gff3(path)

            self.assertTrue(any("gff-version" in error for error in result.errors))

    def test_rejects_dangling_parent_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\nchr1\tf\tmRNA\t1\t10\t.\t+\t.\tID=m1;Parent=missing\n",
            )

            result = validate_inputs.parse_gff3(path)

            self.assertTrue(any("Parent 'missing' has no matching ID" in error for error in result.errors))

    def test_rejects_invalid_coordinates_and_strand(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\nchr1\tf\tgene\t10\t1\t.\tx\t.\tID=g1\n",
            )

            result = validate_inputs.parse_gff3(path)

            self.assertTrue(any("not a valid 1-based range" in error for error in result.errors))
            self.assertTrue(any("strand 'x'" in error for error in result.errors))

    def test_rejects_invalid_cds_phase(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\nchr1\tf\tCDS\t1\t10\t.\t+\t.\tID=c1\n",
            )

            result = validate_inputs.parse_gff3(path)

            self.assertTrue(any("CDS phase must be 0, 1, or 2" in error for error in result.errors))


class CrossCheckTests(unittest.TestCase):
    def test_flags_gff3_seqid_missing_from_fasta(self) -> None:
        fasta = validate_inputs.FastaResult(sequence_ids=["chr1"])
        gff3 = validate_inputs.Gff3Result(seqids={"chr1", "chr2"})

        errors = validate_inputs.cross_check(fasta, gff3)

        self.assertEqual(errors, ["GFF3 seqid 'chr2' is not present in the reference FASTA"])


class MainOnFixturesTests(unittest.TestCase):
    def test_the_synthetic_fixtures_pass_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "input-validation.json"

            exit_code = validate_inputs.main(
                [
                    "--reference-fasta", str(FIXTURES_DIR / "reference.fasta"),
                    "--reference-gff3", str(FIXTURES_DIR / "reference.gff3"),
                    "--target-fasta", str(FIXTURES_DIR / "target.fasta"),
                    "--output", str(output),
                ]
            )

            self.assertEqual(exit_code, 0)
            summary = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "passed")
            self.assertEqual(summary["reference_fasta"]["sequence_count"], 2)
            self.assertEqual(summary["reference_gff3"]["feature_count"], 10)

    def test_a_failing_input_is_still_reported_and_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            reference_fasta = root / "reference.fasta"
            reference_gff3 = root / "reference.gff3"
            target_fasta = root / "target.fasta"
            reference_fasta.write_text(">chr1\nACGT\n", encoding="utf-8")
            reference_gff3.write_text(
                "##gff-version 3\nchr2\tf\tgene\t1\t10\t.\t+\t.\tID=g1\n", encoding="utf-8"
            )
            target_fasta.write_text(">t1\nACGT\n", encoding="utf-8")
            output = root / "input-validation.json"

            exit_code = validate_inputs.main(
                [
                    "--reference-fasta", str(reference_fasta),
                    "--reference-gff3", str(reference_gff3),
                    "--target-fasta", str(target_fasta),
                    "--output", str(output),
                ]
            )

            self.assertEqual(exit_code, 0, "a failed report must still be written and exit cleanly")
            summary = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "failed")
            self.assertEqual(
                summary["cross_checks"]["errors"],
                ["GFF3 seqid 'chr2' is not present in the reference FASTA"],
            )


if __name__ == "__main__":
    unittest.main()
