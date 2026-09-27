import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

validate_run_inputs = load_script("validate_run_inputs")


class ValidateRunInputsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.backbone = self.root / "backbone.fasta"
        self.backbone.write_text(">chr1\nACGT\n", encoding="utf-8")
        self.reads = []
        for name in ("a_R1.fastq", "a_R2.fastq", "b_R1.fastq", "b_R2.fastq"):
            path = self.root / name
            path.write_text("@r\nACGT\n+\nIIII\n", encoding="utf-8")
            self.reads.append(str(path))

    def run_validation(self, *extra: str) -> tuple[int, dict]:
        output = self.root / "results" / "input-validation.json"
        # A failed validation prints its report into the job log; keep it out of the test output.
        with contextlib.redirect_stdout(io.StringIO()):
            exit_code = validate_run_inputs.main(
                [
                    "--backbone-fasta", str(self.backbone),
                    "--read-pair", "isolate-a", self.reads[0], self.reads[1], "untrimmed",
                    "--read-pair", "isolate-a", self.reads[2], self.reads[3], "trimmed",
                    *extra,
                    "--output", str(output),
                ]
            )
        return exit_code, json.loads(output.read_text(encoding="utf-8"))

    def test_passes_and_records_every_read_pair_per_isolate(self) -> None:
        exit_code, report = self.run_validation()
        self.assertEqual(exit_code, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["backbone_fasta"]["sequence_lengths"], {"chr1": 4})
        pairs = report["isolates"]["isolate-a"]["read_pairs"]
        self.assertEqual([pair["trimmed"] for pair in pairs], [False, True])

    def test_fails_on_a_missing_or_empty_read_file_and_keeps_the_report(self) -> None:
        Path(self.reads[3]).unlink()
        empty = self.root / "empty_R1.fastq"
        empty.write_text("", encoding="utf-8")
        exit_code, report = self.run_validation(
            "--read-pair", "isolate-b", str(empty), self.reads[0], "untrimmed",
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["status"], "failed")
        self.assertIn("file not found", report["isolates"]["isolate-a"]["errors"][0])
        self.assertIn("file is empty", report["isolates"]["isolate-b"]["errors"][0])

    def test_fails_on_an_invalid_backbone(self) -> None:
        self.backbone.write_text("not fasta\n", encoding="utf-8")
        exit_code, report = self.run_validation()
        self.assertEqual(exit_code, 1)
        self.assertTrue(report["backbone_fasta"]["errors"])


if __name__ == "__main__":
    unittest.main()
