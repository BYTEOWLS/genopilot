import json
import tempfile
import unittest
from pathlib import Path

from ._load import FIXTURES_DIR, load_script

validate_inputs = load_script("validate_inputs")


class UnresolvedTargetBaseTests(unittest.TestCase):
    def test_warns_only_about_unresolved_target_bases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clean = Path(tmp) / "clean.fasta"
            clean.write_text(">a\nACGT\n", encoding="utf-8")
            unresolved = Path(tmp) / "unresolved.fasta"
            unresolved.write_text(">a\nACNR\n", encoding="utf-8")

            clean_result = validate_inputs.check_fasta(clean)
            validate_inputs.warn_about_unresolved_target_bases(clean_result)
            unresolved_result = validate_inputs.check_fasta(unresolved)
            validate_inputs.warn_about_unresolved_target_bases(unresolved_result)

            self.assertEqual(clean_result.warnings, [])
            self.assertEqual(len(unresolved_result.warnings), 1)
            self.assertEqual(unresolved_result.errors, [])


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

            result = validate_inputs.check_gff3(path)

            self.assertEqual(result.errors, [])
            self.assertEqual(result.feature_count, 6)
            self.assertEqual(result.seqids, {"chr1"})

    def test_rejects_missing_version_pragma(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, "chr1\tf\tgene\t1\t10\t.\t+\t.\tID=g1\n")

            result = validate_inputs.check_gff3(path)

            self.assertTrue(any("gff-version" in error for error in result.errors))

    def test_rejects_dangling_parent_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\nchr1\tf\tmRNA\t1\t10\t.\t+\t.\tID=m1;Parent=missing\n",
            )

            result = validate_inputs.check_gff3(path)

            self.assertTrue(any("Parent 'missing' has no matching ID" in error for error in result.errors))

    def test_rejects_invalid_coordinates_and_strand(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\nchr1\tf\tgene\t10\t1\t.\tx\t.\tID=g1\n",
            )

            result = validate_inputs.check_gff3(path)

            self.assertTrue(any("not a valid 1-based range" in error for error in result.errors))
            self.assertTrue(any("strand 'x'" in error for error in result.errors))

    def test_rejects_invalid_cds_phase(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(
                tmp,
                "##gff-version 3\nchr1\tf\tCDS\t1\t10\t.\t+\t.\tID=c1\n",
            )

            result = validate_inputs.check_gff3(path)

            self.assertTrue(any("CDS phase must be 0, 1, or 2" in error for error in result.errors))


class CrossCheckTests(unittest.TestCase):
    def test_flags_gff3_seqid_missing_from_fasta(self) -> None:
        fasta = validate_inputs.FastaCheck(sequence_ids=["chr1"])
        gff3 = validate_inputs.Gff3Check(seqids={"chr1", "chr2"})

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
            temp_dir = Path(tmp)
            reference_fasta = temp_dir / "reference.fasta"
            reference_gff3 = temp_dir / "reference.gff3"
            target_fasta = temp_dir / "target.fasta"
            reference_fasta.write_text(">chr1\nACGT\n", encoding="utf-8")
            reference_gff3.write_text(
                "##gff-version 3\nchr2\tf\tgene\t1\t10\t.\t+\t.\tID=g1\n", encoding="utf-8"
            )
            target_fasta.write_text(">t1\nACGT\n", encoding="utf-8")
            output = temp_dir / "input-validation.json"

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
