import tempfile
import unittest
from pathlib import Path

from ._load import load_script

fasta = load_script("fasta")


class ParseFastaTests(unittest.TestCase):
    def test_reports_sequence_ids_and_lengths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nACGT\nACGT\n>b\nNNNN\n", encoding="utf-8")

            result = fasta.check_fasta(path)

            self.assertEqual(result.sequence_ids, ["a", "b"])
            self.assertEqual(result.sequence_lengths, {"a": 8, "b": 4})
            self.assertEqual(result.errors, [])

    def test_flags_duplicate_ids_and_empty_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nACGT\n>a\n>b\nACGT\n", encoding="utf-8")

            result = fasta.check_fasta(path)

            self.assertTrue(any("duplicate sequence id 'a'" in error for error in result.errors))
            self.assertTrue(any("no sequence data" in error for error in result.errors))

    def test_flags_non_iupac_characters(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nACGTZZZ\n", encoding="utf-8")

            result = fasta.check_fasta(path)

            self.assertTrue(any("non-IUPAC characters" in error for error in result.errors))

    def test_counts_unresolved_bases_and_reads_soft_masking_as_resolved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text(">a\nacgtNNnR\n>b\nACGTYs-\n", encoding="utf-8")

            result = fasta.check_fasta(path)

            self.assertEqual(result.unresolved_bases, {"n": 3, "iupac": 4})
            self.assertEqual(result.errors, [])

    def test_flags_empty_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "in.fasta"
            path.write_text("", encoding="utf-8")

            result = fasta.check_fasta(path)

            self.assertIn("file contains no FASTA records", result.errors)


if __name__ == "__main__":
    unittest.main()
