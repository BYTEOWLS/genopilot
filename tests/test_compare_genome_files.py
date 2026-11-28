"""Synthetic inputs for the standalone reference-file comparison utility."""

import gzip
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "compare-genome-files.py"


class CompareGenomeFilesTests(unittest.TestCase):
    def compare(self, left, right, suffix=".fna", options=(), compressed=False):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / (name + suffix) for name in ("left", "right")]
            for path, content in zip(paths, (left, right)):
                if compressed:
                    with gzip.open(path, "wt") as handle:
                        handle.write(content)
                else:
                    path.write_text(content)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), *map(str, paths), *options],
                capture_output=True, text=True, check=False,
            )
            return result, json.loads(result.stdout) if result.stdout else None

    def test_fasta_wrapping_and_record_order(self):
        result, report = self.compare(">a description\nAC\nGT\n>b\nNN\n", ">b\nNN\n>a description\nACGT\n")
        self.assertEqual(result.returncode, 0)
        self.assertFalse(report["bytes_equal"])
        self.assertEqual(report["comparison"]["unchanged_sequences"], 2)

    def test_fasta_changes_and_missing_records(self):
        result, report = self.compare(">a\nACG\n>b\nTT\n", ">a\nACTA\n>c\nTT\n")
        self.assertEqual(result.returncode, 1)
        comparison = report["comparison"]
        self.assertEqual(comparison["changed_sequences"]["count"], 1)
        self.assertEqual(comparison["left_only"]["examples"], ["b"])
        self.assertEqual(comparison["right_only"]["examples"], ["c"])

    def test_headers_and_soft_masking_are_not_silently_ignored(self):
        result, report = self.compare(">a old\nAC\n", ">a new\nAC\n")
        self.assertEqual(result.returncode, 1)
        self.assertTrue(report["comparison"]["sequences_equal"])
        result, report = self.compare(">a\nAC\n", ">a\nAc\n")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(report["comparison"]["sequences_equal"])

    def test_invalid_fasta_fails(self):
        for bad in ("", "AC\n", ">\nAC\n", ">a\n", ">a\nAC\n>a\nTT\n"):
            with self.subTest(bad=bad):
                result, report = self.compare(bad, ">a\nAC\n")
                self.assertEqual(result.returncode, 2)
                self.assertIsNone(report)
                self.assertTrue(result.stderr)

    def test_gzip_protein_fasta(self):
        result, report = self.compare(">p\nM*X\n", ">p\nM*\nX\n", ".faa.gz", compressed=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["format"], "fasta")

    def test_gff_order_comments_and_attributes(self):
        first = "ctg\tsource\tgene\t1\t3\t.\t+\t.\tID=g;Name=x"
        second = "ctg\tsource\tCDS\t1\t3\t.\t+\t0\tParent=g"
        result, report = self.compare(
            f"##gff-version 3\n{first}\n{second}\n",
            f"# another comment\n{second}\n{first.replace('ID=g;Name=x', 'Name=x;ID=g;')}\n",
            ".gff3")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["comparison"]["unchanged_features"], 2)

    def test_gff_duplicate_multiplicity_and_limit(self):
        row = "ctg\ts\tgene\t1\t3\t.\t+\t.\tID=g\n"
        result, report = self.compare(row * 3, row, ".gff", ("--limit", "1"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["comparison"]["left_only_rows"]["count"], 2)
        self.assertEqual(len(report["comparison"]["left_only_rows"]["examples"]), 1)

    def test_gff_coordinate_and_embedded_fasta_changes(self):
        row = "ctg\ts\tgene\t1\t3\t.\t+\t.\tID=g\n"
        result, report = self.compare(row, row.replace("\t3\t", "\t4\t"), ".gff")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["comparison"]["left_only_rows"]["count"], 1)
        result, report = self.compare(row + "##FASTA\n>ctg\nACG\n",
                                      row + "##FASTA\n>ctg\nACT\n", ".gff")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(report["comparison"]["embedded_fasta"]["sequences_equal"])

    def test_malformed_gff_and_truncated_gzip_fail(self):
        result, _ = self.compare("not gff\n", "", ".gff")
        self.assertEqual(result.returncode, 2)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.fna.gz"
            path.write_bytes(gzip.compress(b">a\nACGT\n")[:-5])
            result = subprocess.run([sys.executable, str(SCRIPT), str(path), str(path)],
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)

    def test_text_newlines_and_extra_lines(self):
        result, report = self.compare("a\nb\n", "a\nb\nc\n", ".txt", ("--limit", "0"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["comparison"]["different_line_positions"], 1)
        self.assertEqual(report["comparison"]["examples"], [])
        result, _ = self.compare("a\r\n", "a\n", ".txt")
        self.assertEqual(result.returncode, 0)

    def test_missing_file_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = str(Path(directory) / "missing.fna")
            result = subprocess.run([sys.executable, str(SCRIPT), missing, missing],
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
