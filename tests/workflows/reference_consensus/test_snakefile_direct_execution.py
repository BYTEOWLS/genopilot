"""Direct-Snakemake execution of the reference-consensus workflow, independent of the TUI.

Requires a `snakemake` binary on PATH (the pinned version declared in
`src/tooling/policy.ts`); skipped otherwise. Runs without `--use-conda`, so
only the standard-library steps run here: backbone resolution for a local
FASTA, input validation, and read-pair validation.
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ._load import WORKFLOW_DIR
from .fixtures import FIXTURES_DIR, write_run

SNAKEMAKE_BIN = shutil.which("snakemake")


def run_snakemake(run_dir: Path, config_path: Path, *extra_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            SNAKEMAKE_BIN,
            "--snakefile", str(WORKFLOW_DIR / "Snakefile"),
            "--directory", str(run_dir),
            "--configfile", str(config_path),
            "--cores", "2",
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )


@unittest.skipUnless(SNAKEMAKE_BIN, "snakemake is not on PATH")
class ReferenceConsensusDirectExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.run_dir = self.root / "runs" / "test-run"

    def validation_targets(self, *reports: str) -> list[str]:
        return ["resolved/backbone.fasta", "results/input-validation.json", *reports]

    def test_validates_the_inputs_and_every_read_pair(self) -> None:
        config_path = write_run(self.run_dir, ["iso-a", "iso-b"])
        reports = [
            "results/isolates/iso-a/pairs/1/read-validation.json",
            "results/isolates/iso-b/pairs/1/read-validation.json",
            "results/isolates/iso-b/pairs/2/read-validation.json",
        ]
        dry_run = run_snakemake(self.run_dir, config_path, "--dry-run", *self.validation_targets(*reports))
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)

        result = run_snakemake(self.run_dir, config_path, *self.validation_targets(*reports))
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.run_dir / "results" / "input-validation.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "passed")
        for path in reports:
            pair_report = json.loads((self.run_dir / path).read_text(encoding="utf-8"))
            self.assertEqual(pair_report["status"], "passed", path)
        second_run = json.loads((self.run_dir / reports[2]).read_text(encoding="utf-8"))
        self.assertTrue(second_run["trimmed"])
        first_library, second_library = (
            (self.run_dir / f"results/isolates/iso-b/pairs/{pair}/read-group.txt")
            .read_text(encoding="utf-8").split("\\t")[4]
            for pair in (1, 2)
        )
        self.assertEqual(first_library, second_library)

    def test_a_failing_pair_fails_its_job_while_other_isolates_continue(self) -> None:
        reads_dir = self.root / "renamed"
        reads_dir.mkdir()
        for mate in ("R1", "R2"):
            (reads_dir / f"renamed_{mate}.fastq").write_text(
                "@SRR1234567.1 1 length=4\nACGT\n+\nIIII\n", encoding="utf-8")
        config_path = write_run(
            self.run_dir,
            ["iso-c"],
            extra_isolates=[{"id": "public-reads", "read_pairs": [
                {"r1": str(reads_dir / "renamed_R1.fastq"), "r2": str(reads_dir / "renamed_R2.fastq"),
                 "trimmed": False},
            ]}],
        )
        reports = [
            "results/isolates/iso-c/pairs/1/read-validation.json",
            "results/isolates/iso-c/pairs/2/read-validation.json",
            "results/isolates/public-reads/pairs/1/read-validation.json",
        ]
        result = run_snakemake(self.run_dir, config_path, "--keep-going", *self.validation_targets(*reports))
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.run_dir / reports[0]).is_file())
        self.assertTrue((self.run_dir / reports[1]).is_file())
        self.assertFalse((self.run_dir / reports[2]).exists())
        log = (self.run_dir / "logs/isolates/public-reads/pairs/1/validate-read-pair.log").read_text(encoding="utf-8")
        self.assertIn("not an Illumina read name", log)

    def test_a_complete_run_aggregates_support_over_every_selected_isolate(self) -> None:
        config_path = write_run(self.run_dir, ["iso-a", "iso-b"])
        result = run_snakemake(self.run_dir, config_path, "--dry-run", "--printshellcmds")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("rule aggregate_support:", result.stdout)
        for isolate in ("iso-a", "iso-b"):
            self.assertIn(f"--voter {isolate} results/isolates/{isolate}/variants.vcf.gz", result.stdout)

    def test_refuses_to_schedule_a_run_whose_read_file_is_missing(self) -> None:
        reads_dir = self.root / "copied"
        shutil.copytree(FIXTURES_DIR / "reads" / "iso-c", reads_dir)
        config_path = write_run(self.run_dir, [], extra_isolates=[{"id": "iso-copy", "read_pairs": [
            {"r1": str(reads_dir / "IsoC_S3_L001_R1_001.fastq.gz"),
             "r2": str(reads_dir / "IsoC_S3_L001_R2_001.fastq.gz"), "trimmed": False},
        ]}])
        (reads_dir / "IsoC_S3_L001_R2_001.fastq.gz").unlink()
        result = run_snakemake(self.run_dir, config_path, "--dry-run")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("IsoC_S3_L001_R2_001.fastq.gz", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
