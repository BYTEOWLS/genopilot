"""Direct-Snakemake execution of the reference-consensus workflow, independent of the TUI.

Requires a `snakemake` binary on PATH (the pinned version declared in
`src/tooling/policy.ts`); skipped otherwise. Runs without `--use-conda`, so
only the standard-library steps run here: backbone resolution for a local
FASTA, input validation, and read-pair validation.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ._load import WORKFLOW_DIR
from ..annotation_transfer._load import PROJECT_ROOT
from .fixtures import FIXTURES_DIR, write_decision, write_run

SNAKEMAKE_BIN = shutil.which("snakemake")


LOGGER_DIR = PROJECT_ROOT / "workflows" / "shared" / "logging"


def dry_run_jobs(events_path: Path) -> dict:
    """The jobs per rule of the last `run-info` event the run-events logger wrote."""
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    plans = [event for event in events if event["type"] == "run-info"]
    return plans[-1]["jobs"] if plans else {}


def run_snakemake(
    run_dir: Path, config_path: Path, *extra_args: str, env: dict | None = None,
) -> subprocess.CompletedProcess:
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
        env=env,
    )


@unittest.skipUnless(SNAKEMAKE_BIN, "snakemake is not on PATH")
class ReferenceConsensusDirectExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.temp_dir = Path(self._tmp.name)
        self.run_dir = self.temp_dir / "runs" / "test-run"

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
        reads_dir = self.temp_dir / "renamed"
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
        self.assertIn("rule generate_consensus:", result.stdout)
        self.assertIn("--voting-method strict-majority --min-callable-isolates 0 --unresolved-snp n", result.stdout)

    def test_an_iteration_schedules_only_its_voting_isolates_and_its_decision(self) -> None:
        config_path = write_run(self.run_dir, ["iso-a", "iso-b", "iso-c"])
        target = write_decision(
            self.run_dir, 2, ["iso-a", "iso-c"], ["iso-b"],
            {"voting_method": "plurality", "include_backbone_vote": False, "min_callable_isolates": 1,
             "unresolved_snp": "iupac"},
        )
        result = run_snakemake(self.run_dir, config_path, "--dry-run", "--printshellcmds", target)
        self.assertEqual(result.returncode, 0, result.stderr)
        planned = result.stdout
        for rule in ("aggregate_support", "generate_consensus", "record_iteration_provenance"):
            self.assertIn(f"rule {rule}:", planned, rule)
        self.assertNotIn("rule record_consensus_provenance:", planned)
        self.assertIn("--include-backbone-vote no --voter iso-a", planned)
        self.assertIn("--voter iso-c results/isolates/iso-c/variants.vcf.gz", planned)
        self.assertNotIn("--voter iso-b", planned)
        self.assertNotIn("results/isolates/iso-b/", planned)
        self.assertIn("--voting-method plurality --min-callable-isolates 1 --unresolved-snp iupac", planned)
        self.assertIn("results/cohort/iteration-2/support-sites.tsv", planned)
        self.assertNotIn("results/cohort/initial/", planned)

        # The run's default target is still the initial run over every selected isolate.
        initial = run_snakemake(self.run_dir, config_path, "--dry-run", "--printshellcmds")
        self.assertEqual(initial.returncode, 0, initial.stderr)
        self.assertIn("--voter iso-b results/isolates/iso-b/variants.vcf.gz", initial.stdout)
        self.assertIn("results/cohort/initial/support-sites.tsv", initial.stdout)
        self.assertNotIn("iteration-2", initial.stdout)

    def test_an_iteration_dry_run_reports_its_jobs_as_run_events(self) -> None:
        """GenoPilot executes an iteration only when its dry run's run-info counts no other rule than
        the three cohort rules; see consensus Task 5.3."""
        config_path = write_run(self.run_dir, ["iso-a", "iso-b"])
        target = write_decision(self.run_dir, 2, ["iso-a"], ["iso-b"], {"voting_method": "plurality"})
        # The voter's finished per-isolate results, as an earlier attempt left them.
        voter_outputs = ["variants.vcf.gz", "variants.vcf.gz.csi", "callable-mask.bed"]
        for path in ["resolved/backbone.fasta", "resolved/backbone.fasta.fai",
                     *(f"results/isolates/iso-a/{name}" for name in voter_outputs)]:
            (self.run_dir / path).parent.mkdir(parents=True, exist_ok=True)
            (self.run_dir / path).write_text("placeholder\n", encoding="utf-8")
        env = {**os.environ, "PYTHONPATH": str(LOGGER_DIR)}

        def dry_run(name: str) -> dict:
            # GenoPilot creates this directory for the dry run's own logs before starting it.
            events = self.run_dir / f"logs/cohort/iteration-2/{name}.events.jsonl"
            events.parent.mkdir(parents=True, exist_ok=True)
            result = run_snakemake(
                self.run_dir, config_path, "--dry-run", "--rerun-incomplete",
                "--logger", "genopilot-run-events", "--logger-genopilot-run-events-path", str(events),
                target, env=env,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return dry_run_jobs(events)

        self.assertEqual(
            dry_run("allowed"),
            {"aggregate_support": 1, "generate_consensus": 1, "record_iteration_provenance": 1},
        )
        # Without the voter's callable mask, Snakemake would recompute it, which GenoPilot refuses.
        (self.run_dir / "results/isolates/iso-a/callable-mask.bed").unlink()
        refused = dry_run("refused")
        self.assertIn("classify_callability", refused)
        self.assertEqual(refused.get("aggregate_support"), 1)
        # A dry run records its plan in its own file, never in the run's events.jsonl.
        self.assertFalse((self.run_dir / "events.jsonl").exists())

    def test_an_iteration_without_a_saved_decision_is_refused_by_name(self) -> None:
        config_path = write_run(self.run_dir, ["iso-a", "iso-b"])
        missing = run_snakemake(self.run_dir, config_path, "--dry-run", "provenance/cohort/iteration-5.json")
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("decisions/iteration-5.yaml does not exist", missing.stdout + missing.stderr)

        # Iteration 1 is the initial cohort, never a saved decision.
        write_decision(self.run_dir, 1, ["iso-a"], ["iso-b"])
        first = run_snakemake(self.run_dir, config_path, "--dry-run", "provenance/cohort/iteration-1.json")
        self.assertNotEqual(first.returncode, 0)
        self.assertIn("MissingRuleException", first.stdout + first.stderr)

    def test_an_iteration_excluding_a_failing_isolate_does_not_depend_on_it(self) -> None:
        reads_dir = self.temp_dir / "renamed"
        reads_dir.mkdir()
        for mate in ("R1", "R2"):
            (reads_dir / f"renamed_{mate}.fastq").write_text(
                "@SRR1234567.1 1 length=4\nACGT\n+\nIIII\n", encoding="utf-8")
        config_path = write_run(
            self.run_dir,
            ["iso-a"],
            extra_isolates=[{"id": "public-reads", "read_pairs": [
                {"r1": str(reads_dir / "renamed_R1.fastq"), "r2": str(reads_dir / "renamed_R2.fastq"),
                 "trimmed": False},
            ]}],
        )
        failing = "results/isolates/public-reads/pairs/1/read-validation.json"
        failed = run_snakemake(self.run_dir, config_path, *self.validation_targets(failing))
        self.assertNotEqual(failed.returncode, 0)

        target = write_decision(self.run_dir, 2, ["iso-a"], ["public-reads"])
        result = run_snakemake(self.run_dir, config_path, "--dry-run", target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("public-reads", result.stdout)
        self.assertTrue((self.run_dir / "logs/isolates/public-reads/pairs/1/validate-read-pair.log").is_file())

    def test_refuses_to_schedule_a_run_whose_read_file_is_missing(self) -> None:
        reads_dir = self.temp_dir / "copied"
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
