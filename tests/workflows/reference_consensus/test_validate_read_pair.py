import contextlib
import gzip
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from ..shared._load import PROJECT_ROOT
from ._load import load_script

validate_read_pair = load_script("validate_read_pair")

FIXTURE_READS = PROJECT_ROOT / "tests" / "fixtures" / "reference-consensus" / "reads"


def record(name: str, mate: int, bases: str = "ACGTACGTAC", comment: str | None = None) -> str:
    header = f"@{name}" + (f" {comment}" if comment is not None else f" {mate}:N:0:ACGTACGT+TTGCAGCA")
    return f"{header}\n{bases}\n+\n{'I' * len(bases)}\n"


def illumina_name(number: int, lane: int = 1, flowcell: str = "FCX", run: int = 5, instrument: str = "M1") -> str:
    return f"{instrument}:{run}:{flowcell}:{lane}:1101:{number}:100"


class ValidateReadPairTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.temp_dir = Path(self._tmp.name)

    def write_pair(self, r1: str, r2: str, name: str = "Sample1_S1_L001", compress: bool = True) -> tuple[Path, Path]:
        suffix = ".fastq.gz" if compress else ".fastq"
        paths = []
        for mate, text in (("R1", r1), ("R2", r2)):
            path = self.temp_dir / f"{name}_{mate}_001{suffix}"
            data = text.encode("ascii")
            path.write_bytes(gzip.compress(data, mtime=0) if compress else data)
            paths.append(path)
        return paths[0], paths[1]

    def run_script(self, r1: Path, r2: Path, isolate: str = "isolate-a", trimmed: str = "untrimmed") -> tuple[int, dict, Path]:
        report = self.temp_dir / "out" / "read-validation.json"
        read_group = self.temp_dir / "out" / "read-group.txt"
        with contextlib.redirect_stdout(io.StringIO()):
            exit_code = validate_read_pair.main(
                ["--isolate-id", isolate, "--pair", "1", "--r1", str(r1), "--r2", str(r2),
                 "--trimmed", trimmed, "--library-id", "confirmed-library", "--read-set-id", "reads",
                 "--read-group-id", "group-1", "--preprocessing-json", "{}",
                 "--report", str(report), "--read-group", str(read_group)]
            )
        return exit_code, json.loads(report.read_text(encoding="utf-8")), read_group

    def test_passes_a_fixture_pair_and_writes_its_read_group(self) -> None:
        r1 = FIXTURE_READS / "iso-c" / "IsoC_S3_L001_R1_001.fastq.gz"
        r2 = FIXTURE_READS / "iso-c" / "IsoC_S3_L001_R2_001.fastq.gz"
        exit_code, report, read_group = self.run_script(r1, r2, isolate="iso-c")
        self.assertEqual(exit_code, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["files"]["r1"]["sha256"], hashlib.sha256(r1.read_bytes()).hexdigest())
        self.assertEqual(report["sequencing"]["lanes"], [1])
        self.assertEqual(
            report["read_group"],
            {"id": "group-1", "pu": "FCA0001.1.CTAGCTAG+GGTTAACC", "sm": "iso-c",
             "lb": "confirmed-library", "pl": "ILLUMINA", "library_source": "explicit",
             "id_source": "generated", "sequencing_source": "headers"},
        )
        self.assertEqual(
            read_group.read_text(encoding="utf-8"),
            "@RG\\tID:group-1\\tPU:FCA0001.1.CTAGCTAG+GGTTAACC"
            "\\tSM:iso-c\\tLB:confirmed-library\\tPL:ILLUMINA\n",
        )

    def test_a_lane_merged_pair_leaves_the_lane_out_of_its_read_group(self) -> None:
        r1, r2 = self.write_pair(
            record(illumina_name(1, lane=1), 1) + record(illumina_name(2, lane=2), 1),
            record(illumina_name(1, lane=1), 2) + record(illumina_name(2, lane=2), 2),
            name="Sample1_S1",
        )
        exit_code, report, _ = self.run_script(r1, r2)
        self.assertEqual(exit_code, 0)
        self.assertEqual(report["sequencing"]["lanes"], [1, 2])
        self.assertEqual(report["read_group"]["pu"], "FCX.ACGTACGT+TTGCAGCA")

    def test_reads_plain_fastq_and_a_file_name_that_is_not_illumina(self) -> None:
        r1, r2 = self.write_pair(record(illumina_name(1), 1), record(illumina_name(1), 2),
                                 name="reads", compress=False)
        exit_code, report, _ = self.run_script(r1, r2, trimmed="trimmed")
        self.assertEqual(exit_code, 0)
        self.assertTrue(report["trimmed"])
        self.assertEqual(report["read_group"]["lb"], "confirmed-library")
        self.assertEqual(report["read_group"]["library_source"], "explicit")

    def test_a_record_without_a_barcode_keeps_the_read_group_without_one(self) -> None:
        r1, r2 = self.write_pair(record(illumina_name(1), 1, comment="1:N:0:"),
                                 record(illumina_name(1), 2, comment="2:N:0:"))
        exit_code, report, _ = self.run_script(r1, r2)
        self.assertEqual(exit_code, 0)
        self.assertIsNone(report["sequencing"]["barcode"])
        self.assertEqual(report["read_group"]["pu"], "FCX.1")
        self.assertEqual(report["read_group"]["lb"], "confirmed-library")

    def test_a_differing_barcode_does_not_reject_the_pair(self) -> None:
        r1, r2 = self.write_pair(
            record(illumina_name(1), 1) + record(illumina_name(2), 1, comment="1:N:0:ACGTACGN+TTGCAGCA"),
            record(illumina_name(1), 2) + record(illumina_name(2), 2, comment="2:N:0:ACGTACGN+TTGCAGCA"),
        )
        exit_code, report, _ = self.run_script(r1, r2)
        self.assertEqual(exit_code, 0)
        self.assertIsNone(report["sequencing"]["barcode"])

    def assert_fails(self, r1_text: str, r2_text: str, message: str) -> dict:
        r1, r2 = self.write_pair(r1_text, r2_text)
        exit_code, report, read_group = self.run_script(r1, r2)
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["status"], "failed")
        self.assertIsNone(report["read_group"])
        self.assertFalse(read_group.exists())
        self.assertTrue(any(message in error for error in report["errors"]), report["errors"])
        return report

    def test_accepts_archive_headers_without_inventing_sequencing_metadata(self) -> None:
        r1, r2 = self.write_pair(record("SRR1234567.1/1", 1), record("SRR1234567.1/2", 2), compress=False)
        exit_code, report, read_group = self.run_script(r1, r2)
        self.assertEqual(exit_code, 0)
        self.assertIsNone(report["sequencing"])
        self.assertNotIn("pu", report["read_group"])
        self.assertEqual(report["read_group"]["library_source"], "explicit")
        self.assertNotIn("PU:", read_group.read_text())

    def test_rejects_a_record_from_another_flowcell_but_not_another_lane(self) -> None:
        self.assert_fails(
            record(illumina_name(1), 1) + record(illumina_name(2, flowcell="FCY"), 1),
            record(illumina_name(1), 2) + record(illumina_name(2, flowcell="FCY"), 2),
            "instrument, run, or flowcell differs",
        )

    def test_rejects_mates_with_different_record_counts(self) -> None:
        self.assert_fails(
            record(illumina_name(1), 1) + record(illumina_name(2), 1),
            record(illumina_name(1), 2),
            "mate record counts differ",
        )

    def test_rejects_an_empty_pair(self) -> None:
        self.assert_fails("", "", "holds no records")

    def test_rejects_archive_mate_disagreements_and_malformed_provider_processed_records(self) -> None:
        self.assert_fails(record("SRR1.1", 1), record("SRR1.2", 2), "mate names differ")
        r1, r2 = self.write_pair(record("SRR1.1", 1), "@SRR1.1\nACGT\n+\nI\n", compress=False)
        exit_code, report, _ = self.run_script(r1, r2, trimmed="trimmed")
        self.assertEqual(exit_code, 1)
        self.assertTrue(any("quality" in error for error in report["errors"]))
        self.assertFalse(report["files"]["r1"]["checksum_complete"])

    def test_rejects_mixed_header_evidence_and_wrong_mate_labels(self) -> None:
        self.assert_fails(record(illumina_name(1), 1) + record("SRR1.2", 1),
                          record(illumina_name(1), 2) + record("SRR1.2", 2), "mixed original and archive")
        self.assert_fails(record("SRR1.1/2", 1), record("SRR1.1/2", 2), "wrong mate suffix")


if __name__ == "__main__":
    unittest.main()
