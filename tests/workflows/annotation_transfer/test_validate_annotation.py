import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

validate_annotation = load_script("validate_annotation")


class MainTests(unittest.TestCase):
    def test_a_well_formed_gff3_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gff3 = root / "lifton.raw.gff3"
            output = root / "validation.json"
            gff3.write_text(
                "##gff-version 3\n"
                "chr1\tLiftOn\tgene\t1\t10\t.\t+\t.\tID=AN_CS_gene1\n"
                "chr1\tLiftOn\tmRNA\t1\t10\t.\t+\t.\tID=AN_CS_mrna1;Parent=AN_CS_gene1\n",
                encoding="utf-8",
            )

            exit_code = validate_annotation.main(
                ["--gff3", str(gff3), "--output", str(output)]
            )

            self.assertEqual(exit_code, 0)
            summary = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "passed")
            self.assertEqual(summary["gff3"]["feature_count"], 2)

    def test_a_dangling_parent_is_reported_but_still_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gff3 = root / "lifton.raw.gff3"
            output = root / "validation.json"
            gff3.write_text(
                "##gff-version 3\nchr1\tLiftOn\tmRNA\t1\t10\t.\t+\t.\tID=m1;Parent=missing\n",
                encoding="utf-8",
            )

            exit_code = validate_annotation.main(
                ["--gff3", str(gff3), "--output", str(output)]
            )

            self.assertEqual(exit_code, 0, "a failed report must still be written and exit cleanly")
            summary = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "failed")
            self.assertTrue(
                any("Parent 'missing' has no matching ID" in error for error in summary["gff3"]["errors"])
            )


if __name__ == "__main__":
    unittest.main()
