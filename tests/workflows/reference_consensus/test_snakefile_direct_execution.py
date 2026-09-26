"""Direct-Snakemake execution of the reference-consensus workflow, independent of the TUI.

Requires a `snakemake` binary on PATH (the pinned version declared in
`src/tooling/policy.ts`); skipped otherwise. Runs without `--use-conda`: the
local backbone and input validation need only the standard library.
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ..annotation_transfer._load import FIXTURES_DIR, PROJECT_ROOT

SNAKEMAKE_BIN = shutil.which("snakemake")
WORKFLOW_DIR = PROJECT_ROOT / "workflows" / "reference-consensus"


def write_run(run_dir: Path, reads_dir: Path) -> Path:
    reads_dir.mkdir(parents=True, exist_ok=True)
    run_dir.mkdir(parents=True, exist_ok=True)
    for mate in ("R1", "R2"):
        (reads_dir / f"a_{mate}.fastq").write_text("@r\nACGT\n+\nIIII\n", encoding="utf-8")
    (run_dir / "isolates.yaml").write_text(
        "\n".join(
            [
                "schema_version: 1",
                'captured_at: "2026-09-25T10:00:00.000Z"',
                "isolates:",
                "  - id: isolate-a",
                "    name: Isolate A",
                "    wildtype: null",
                "    derived_from: null",
                "    read_pairs:",
                f'      - r1: "{reads_dir / "a_R1.fastq"}"',
                f'        r2: "{reads_dir / "a_R2.fastq"}"',
                "        trimmed: false",
                "",
            ]
        ),
        encoding="utf-8",
    )
    config_path = run_dir / "config.yaml"
    config_path.write_text(
        "\n".join(
            [
                "schema_version: 1",
                "workflow_id: reference-consensus",
                "workflow_version: 1",
                "inputs:",
                "  backbone:",
                "    source: local",
                f'    fasta: "{FIXTURES_DIR / "reference.fasta"}"',
                "  isolates_file: isolates.yaml",
                "  selected_isolates: [isolate-a]",
                "calling: {ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8}",
                "consensus: {include_backbone_vote: true, voting_method: strict-majority}",
                "resources: {cpu_mode: automatic, effective_cpus: 1}",
                "run:",
                f'  output_root: "{run_dir.parent}"',
                "  id: test-run",
                '  created_at: "2026-09-25T10:00:00.000Z"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    return config_path


def run_snakemake(run_dir: Path, config_path: Path, *extra_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            SNAKEMAKE_BIN,
            "--snakefile", str(WORKFLOW_DIR / "Snakefile"),
            "--directory", str(run_dir),
            "--configfile", str(config_path),
            "--cores", "1",
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

    def test_resolves_the_backbone_and_validates_the_snapshot(self) -> None:
        config_path = write_run(self.run_dir, self.root / "reads")
        dry_run = run_snakemake(self.run_dir, config_path, "--dry-run")
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)

        result = run_snakemake(self.run_dir, config_path)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.run_dir / "results" / "input-validation.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "passed")
        self.assertTrue((self.run_dir / "resolved" / "backbone.fasta").is_file())

    def test_refuses_to_schedule_a_run_whose_read_file_is_missing(self) -> None:
        config_path = write_run(self.run_dir, self.root / "reads")
        (self.root / "reads" / "a_R2.fastq").unlink()
        result = run_snakemake(self.run_dir, config_path, "--dry-run")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("a_R2.fastq", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
