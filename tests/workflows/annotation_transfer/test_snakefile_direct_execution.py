"""Direct-Snakemake execution tests, independent of the TUI.

Requires a `snakemake` binary on PATH (the pinned version declared in
`src/tooling/policy.ts`); skipped otherwise rather than depending on
locally installed bioinformatics tooling to collect at all.
"""

import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from ..shared._load import LOGGING_DIR
from ._load import FIXTURES_DIR, WORKFLOW_DIR

SNAKEMAKE_BIN = shutil.which("snakemake")
LIFTON_TOOLING_AVAILABLE = all(
    shutil.which(binary) for binary in ("lifton", "miniprot", "minimap2")
)
RUN_CONDA_INTEGRATION = os.environ.get("RUN_SNAKEMAKE_CONDA_INTEGRATION") == "1"
CONDA_BIN = shutil.which("conda")


def write_local_config(run_dir: Path) -> Path:
    config_path = run_dir / "config.yaml"
    config_path.write_text(
        "\n".join(
            [
                "schema_version: 1",
                "workflow_id: annotation-transfer",
                "workflow_version: 1",
                "genopilot:",
                "  version: 1.2.3",
                "inputs:",
                "  reference:",
                "    source: local",
                f"    fasta: {FIXTURES_DIR / 'reference.fasta'}",
                f"    gff3: {FIXTURES_DIR / 'reference.gff3'}",
                "  target:",
                "    source: local",
                f"    fasta: {FIXTURES_DIR / 'target.fasta'}",
                "lifton:",
                "  profile: same-species",
                "review:",
                "  minimum_protein_identity: 99",
                "resources:",
                "  cpu_mode: automatic",
                "  effective_cpus: 1",
                "run:",
                f"  output_root: {run_dir.parent}",
                "  id: test-run",
                '  created_at: "2026-09-05T20:00:00.000Z"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    return config_path


def run_snakemake(
    run_dir: Path,
    config_path: Path,
    *extra_args: str,
    env: dict | None = None,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            SNAKEMAKE_BIN,
            "--snakefile",
            str(WORKFLOW_DIR / "Snakefile"),
            "--directory",
            str(run_dir),
            "--configfile",
            str(config_path),
            "--cores",
            "1",
            *extra_args,
        ],
        capture_output=True,
        text=True,
        env=env,
    )


def terminate_process_group(
    process: subprocess.Popen, timeout: float = 10
) -> tuple[str, str]:
    """Stop a detached test process and always drain its captured output."""
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        return process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        return process.communicate(timeout=timeout)


def write_fake_lifton(bin_dir: Path) -> Path:
    """Install a deterministic LiftOn test double for Snakemake contract tests.

    The scientific result parser is tested separately and real LiftOn remains covered by the
    environment-gated suite below. This executable lets the default direct-Snakemake suite
    exercise scheduling, process failure, persisted outputs, and resume without downloading a
    bioinformatics environment.
    """
    executable = bin_dir / "lifton"
    bin_dir.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        r'''#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path

mode = os.environ.get("FAKE_LIFTON_MODE", "success")
if mode == "fail":
    print("synthetic LiftOn failure", file=sys.stderr)
    sys.exit(23)

output = Path(sys.argv[sys.argv.index("-o") + 1])
output.parent.mkdir(parents=True, exist_ok=True)
diagnostics = output.parent / "lifton_output"
stats = diagnostics / "stats"
intermediate = diagnostics / "intermediate_files"
stats.mkdir(parents=True, exist_ok=True)
intermediate.mkdir(parents=True, exist_ok=True)

parent = "missing-parent" if mode == "validation-failed" else "gene1"
output.write_text(
    "##gff-version 3\n"
    "chr1\tLiftOn\tgene\t1031\t1430\t.\t+\t.\tID=gene1;source=Liftoff\n"
    f"chr1\tLiftOn\tmRNA\t1031\t1430\t.\t+\t.\tID=mrna1;Parent={parent};"
    "status=Liftoff;dna_identity=1.0;protein_identity=1.0\n"
    "chr1\tLiftOn\tCDS\t1031\t1430\t.\t+\t0\tID=cds1;Parent=mrna1\n"
    "chr2\tLiftOn\tgene\t831\t1130\t.\t+\t.\tID=gene2;source=Liftoff\n"
    "chr2\tLiftOn\tmRNA\t831\t1130\t.\t+\t.\tID=mrna2;Parent=gene2;"
    "status=Liftoff;dna_identity=1.0;protein_identity=1.0\n"
    "chr2\tLiftOn\tCDS\t831\t1130\t.\t+\t0\tID=cds2;Parent=mrna2\n",
    encoding="utf-8",
)
manifest_mapped = 99 if mode == "contradictory-evidence" else 2
(diagnostics / "run_manifest.json").write_text(
    json.dumps({
        "counts": {
            "reference_features": 2,
            "mapped_reference_features": manifest_mapped,
            "emitted_feature_copies": 2,
            "miniprot_rescued_genes": 0,
        }
    }),
    encoding="utf-8",
)
if mode != "missing-evidence":
    (intermediate / "auto_feature_types.txt").write_text("gene\n", encoding="utf-8")
(stats / "completeness_by_feature_type.txt").write_text(
    "feature_type\tn_reference\tn_lifted\tn_missed\tn_extra_copies\tn_target\tpct_recovered\n"
    "gene\t2\t2\t0\t0\t2\t1.0\n",
    encoding="utf-8",
)
(stats / "mapped_feature.txt").write_text(
    "gene1\t1\tcoding\ngene2\t1\tcoding\n", encoding="utf-8"
)
(stats / "mapped_transcript.txt").write_text(
    "mrna1\t1\tcoding\nmrna2\t1\tcoding\n", encoding="utf-8"
)
(stats / "unmapped_features.txt").write_text("", encoding="utf-8")
(stats / "extra_copy_features.txt").write_text("", encoding="utf-8")
for suffix in ("liftoff", "miniprot"):
    side_directory = output.parent / f"lifton_output{suffix}"
    side_directory.mkdir(parents=True, exist_ok=True)
    (side_directory / f"{suffix}.gff3").write_text("##gff-version 3\n", encoding="utf-8")

if mode == "interrupt":
    Path(os.environ["FAKE_LIFTON_STARTED"]).write_text("started\n", encoding="utf-8")
    time.sleep(60)
''',
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable


def fake_lifton_environment(bin_dir: Path, mode: str = "success", **values: str) -> dict:
    return {
        **os.environ,
        "PATH": os.pathsep.join([str(bin_dir), os.environ.get("PATH", "")]),
        "FAKE_LIFTON_MODE": mode,
        **values,
    }


def rule_dependencies(run_dir: Path, config_path: Path) -> set:
    """Returns the workflow's rule-to-rule edges as `(dependency, dependent)` pairs.

    `--rulegraph` builds the DAG and prints it as DOT without running anything, so the
    execution order can be asserted without the bioinformatics tooling the rules need.
    """
    result = run_snakemake(run_dir, config_path, "--rulegraph")
    assert result.returncode == 0, result.stderr
    names = dict(re.findall(r'^\t(\d+)\[label = "([^"]+)"', result.stdout, re.MULTILINE))
    return {
        (names[source], names[target])
        for source, target in re.findall(r"^\t(\d+) -> (\d+)$", result.stdout, re.MULTILINE)
    }


@unittest.skipUnless(SNAKEMAKE_BIN, "snakemake is not installed on PATH")
class LocalSourceExecutionTests(unittest.TestCase):
    """Exercises only the resolve/validate-inputs stages, which need no
    bioinformatics tooling beyond Snakemake itself. `rule all` also depends
    on the LiftOn stages; see FullPipelineExecutionTests for those, gated
    on lifton/miniprot/minimap2 actually being installed."""

    def test_resolves_and_validates_the_synthetic_fixtures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = write_local_config(run_dir)

            result = run_snakemake(run_dir, config_path, "results/input-validation.json")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((run_dir / "resolved" / "reference.fasta").is_file())
            self.assertTrue((run_dir / "resolved" / "reference.gff3").is_file())
            self.assertTrue((run_dir / "resolved" / "target.fasta").is_file())
            self.assertEqual(
                (run_dir / "resolved" / "reference.fasta").read_bytes(),
                (FIXTURES_DIR / "reference.fasta").read_bytes(),
            )

            summary = json.loads(
                (run_dir / "results" / "input-validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual(summary["status"], "passed")

            for provenance_name in ["reference.fasta", "reference.gff3", "target.fasta"]:
                provenance = json.loads(
                    (run_dir / "provenance" / f"{provenance_name}.json").read_text(encoding="utf-8")
                )
                self.assertEqual(provenance["source"], "local")
                self.assertEqual(provenance["origin"], "imported")

    def test_rerun_is_a_no_op_once_up_to_date(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = write_local_config(run_dir)
            first = run_snakemake(run_dir, config_path, "results/input-validation.json")
            self.assertEqual(first.returncode, 0, first.stderr)

            second = run_snakemake(run_dir, config_path, "-p", "results/input-validation.json")

            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("Nothing to be done", second.stdout + second.stderr)

    def test_validation_gates_every_scientific_rule(self) -> None:
        """Input validation must complete before LiftOn, not merely alongside it.

        Without the edge asserted here, `validate_inputs` and `transfer_annotation` are
        independent branches that both depend only on the resolved files, so Snakemake may
        schedule them together — and on a many-core machine LiftOn wins the race and runs to
        completion on inputs that were never validated.
        """
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = write_local_config(run_dir)

            edges = rule_dependencies(run_dir, config_path)

            self.assertIn(("validate_inputs", "transfer_annotation"), edges)
            self.assertIn(("resolve_reference", "validate_inputs"), edges)
            self.assertIn(("resolve_target", "validate_inputs"), edges)
            self.assertIn(("transfer_annotation", "validate_annotation"), edges)
            self.assertIn(("validate_annotation", "summarize_annotation_transfer"), edges)
            self.assertIn(
                ("summarize_annotation_transfer", "record_annotation_transfer_provenance"),
                edges,
            )

    def test_records_run_events_through_the_packaged_logger_plugin(self) -> None:
        """The event file is written by Snakemake itself, so a direct run produces it too."""
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = write_local_config(run_dir)
            # Snakemake discovers logger plugins on sys.path, so the packaged plugin directory
            # is made available through PYTHONPATH rather than being installed.
            env = {**os.environ, "PYTHONPATH": str(LOGGING_DIR)}

            result = run_snakemake(
                run_dir,
                config_path,
                "--logger",
                "genopilot-run-events",
                "--logger-genopilot-run-events-path",
                str(run_dir / "events.jsonl"),
                "results/input-validation.json",
                env=env,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            lines = [
                json.loads(line)
                for line in (run_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(all(event["schema_version"] == 1 for event in lines))
            self.assertEqual(lines[0]["type"], "workflow-started")
            self.assertEqual(lines[1]["type"], "run-info")
            self.assertEqual(
                lines[1]["jobs"],
                {"resolve_reference": 1, "resolve_target": 1, "validate_inputs": 1},
            )
            self.assertEqual(lines[1]["total"], 3)

            started = {
                event["rule"] for event in lines if event["type"] == "job-started"
            }
            self.assertEqual(
                started, {"resolve_reference", "resolve_target", "validate_inputs"}
            )
            self.assertEqual(
                len([event for event in lines if event["type"] == "job-finished"]), 3
            )
            self.assertEqual(
                [event["done"] for event in lines if event["type"] == "progress"], [1, 2, 3]
            )
            # Console text stays out of the contract; it is preserved as the run's own logs.
            self.assertNotIn("shellcmd", {event["type"] for event in lines})

    def test_missing_local_input_fails_the_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = run_dir / "config.yaml"
            config_path.write_text(
                "\n".join(
                    [
                        "schema_version: 1",
                        "workflow_id: annotation-transfer",
                        "workflow_version: 1",
                        "genopilot:",
                        "  version: 1.2.3",
                        "inputs:",
                        "  reference:",
                        "    source: local",
                        "    fasta: /nonexistent/reference.fasta",
                        "    gff3: /nonexistent/reference.gff3",
                        "  target:",
                        "    source: local",
                        "    fasta: /nonexistent/target.fasta",
                        "lifton:",
                        "  profile: same-species",
                        "review:",
                        "  minimum_protein_identity: 99",
                "review:",
                "  minimum_protein_identity: 99",
                        "resources:",
                        "  cpu_mode: automatic",
                        "  effective_cpus: 1",
                        "run:",
                        f"  output_root: {run_dir.parent}",
                        "  id: test-run",
                        '  created_at: "2026-09-05T20:00:00.000Z"',
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            result = run_snakemake(run_dir, config_path, "results/input-validation.json")

            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((run_dir / "resolved" / "reference.fasta").exists())


@unittest.skipUnless(SNAKEMAKE_BIN, "snakemake is not installed on PATH")
class DirectExecutionContractTests(unittest.TestCase):
    """Exercises the complete DAG with deterministic synthetic LiftOn evidence.

    These tests cover Snakemake's producer-side execution contract. They intentionally do not
    replace the environment-gated real-LiftOn test, which protects tool compatibility and the
    actual transfer result on the synthetic genomes.
    """

    def prepare(self, temp_dir: Path) -> tuple[Path, Path, Path, dict]:
        run_dir = temp_dir / "runs" / "test-run"
        run_dir.mkdir(parents=True)
        config_path = write_local_config(run_dir)
        bin_dir = temp_dir / "bin"
        write_fake_lifton(bin_dir)
        return run_dir, config_path, bin_dir, fake_lifton_environment(bin_dir)

    def test_successful_fresh_execution_and_no_op_rerun(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir, config_path, _bin_dir, env = self.prepare(Path(tmp))

            first = run_snakemake(run_dir, config_path, env=env)

            self.assertEqual(first.returncode, 0, first.stderr)
            summary_path = run_dir / "results" / "summary.json"
            artifacts_path = run_dir / "artifacts.yaml"
            self.assertEqual(
                json.loads(summary_path.read_text(encoding="utf-8"))["status"], "completed"
            )
            self.assertTrue(artifacts_path.is_file())
            mtimes = {
                path: path.stat().st_mtime_ns
                for path in (
                    run_dir / "results" / "annotation" / "lifton.raw.gff3",
                    summary_path,
                    artifacts_path,
                )
            }

            second = run_snakemake(run_dir, config_path, "-p", env=env)

            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("Nothing to be done", second.stdout + second.stderr)
            self.assertEqual({path: path.stat().st_mtime_ns for path in mtimes}, mtimes)

    def test_failed_lifton_rule_fails_without_a_completion_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir, config_path, bin_dir, _env = self.prepare(Path(tmp))
            env = fake_lifton_environment(bin_dir, "fail")

            result = run_snakemake(run_dir, config_path, env=env)

            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((run_dir / "results" / "summary.json").exists())
            self.assertFalse((run_dir / "artifacts.yaml").exists())
            self.assertIn(
                "synthetic LiftOn failure",
                (run_dir / "logs" / "transfer-annotation.log").read_text(encoding="utf-8"),
            )

    def test_missing_or_contradictory_lifton_evidence_fails_summarization(self) -> None:
        cases = {
            "missing-evidence": "required LiftOn result is missing",
            "contradictory-evidence": "mapped_reference_features' is 99",
        }
        for mode, expected_error in cases.items():
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                run_dir, config_path, bin_dir, _env = self.prepare(Path(tmp))
                env = fake_lifton_environment(bin_dir, mode)

                result = run_snakemake(run_dir, config_path, env=env)

                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((run_dir / "results" / "summary.json").exists())
                self.assertFalse((run_dir / "artifacts.yaml").exists())
                self.assertIn(
                    expected_error,
                    (run_dir / "logs" / "summarize-results.log").read_text(encoding="utf-8"),
                )

    def test_structural_validation_failure_is_persisted_with_a_successful_process(self) -> None:
        """Scientific invalidity is data, not a lost report or a process failure.

        The deliberate contract is that the validator and Snakemake finish successfully after
        preserving the diagnostics. Consumers must use summary.status, not process exit code,
        to decide whether the resulting annotation is scientifically valid.
        """
        with tempfile.TemporaryDirectory() as tmp:
            run_dir, config_path, bin_dir, _env = self.prepare(Path(tmp))
            env = fake_lifton_environment(bin_dir, "validation-failed")

            result = run_snakemake(run_dir, config_path, env=env)

            self.assertEqual(result.returncode, 0, result.stderr)
            validation = json.loads(
                (run_dir / "results" / "validation.json").read_text(encoding="utf-8")
            )
            summary = json.loads(
                (run_dir / "results" / "summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(validation["status"], "failed")
            self.assertGreater(len(validation["gff3"]["errors"]), 0)
            self.assertEqual(summary["status"], "validation-failed")
            self.assertTrue((run_dir / "provenance" / "run.json").is_file())

    def test_failed_input_validation_stops_the_run_before_lifton(self) -> None:
        """The input report is kept as evidence, and LiftOn never starts on invalid inputs."""
        with tempfile.TemporaryDirectory() as tmp:
            run_dir, config_path, bin_dir, _env = self.prepare(Path(tmp))
            broken_gff3 = Path(tmp) / "broken.gff3"
            broken_gff3.write_text(
                "##gff-version 3\nchr1\tsrc\tmRNA\t1\t10\t.\t+\t.\tID=m1;Parent=missing\n",
                encoding="utf-8",
            )
            config_path.write_text(
                config_path.read_text(encoding="utf-8").replace(
                    str(FIXTURES_DIR / "reference.gff3"), str(broken_gff3)
                ),
                encoding="utf-8",
            )
            started = Path(tmp) / "lifton-started"
            env = fake_lifton_environment(bin_dir, "interrupt", FAKE_LIFTON_STARTED=str(started))

            result = run_snakemake(run_dir, config_path, env=env)

            self.assertNotEqual(result.returncode, 0)
            report = json.loads(
                (run_dir / "results" / "input-validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual(report["status"], "failed")
            self.assertFalse(started.exists())
            self.assertFalse((run_dir / "results" / "annotation" / "lifton.raw.gff3").exists())
            self.assertIn(
                "input-validation.json",
                (run_dir / "logs" / "transfer-annotation.log").read_text(encoding="utf-8"),
            )

    def test_interrupted_run_resumes_in_the_same_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            run_dir, config_path, bin_dir, _env = self.prepare(temp_dir)
            started = temp_dir / "lifton-started"
            env = fake_lifton_environment(
                bin_dir, "interrupt", FAKE_LIFTON_STARTED=str(started)
            )
            command = [
                SNAKEMAKE_BIN,
                "--snakefile",
                str(WORKFLOW_DIR / "Snakefile"),
                "--directory",
                str(run_dir),
                "--configfile",
                str(config_path),
                "--cores",
                "1",
            ]
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 20
                while (
                    not started.exists()
                    and process.poll() is None
                    and time.monotonic() < deadline
                ):
                    time.sleep(0.05)
                if not started.exists():
                    stdout, stderr = terminate_process_group(process)
                    self.fail(
                        f"synthetic LiftOn did not start\nstdout:\n{stdout}\nstderr:\n{stderr}"
                    )

                resolved_reference = run_dir / "resolved" / "reference.fasta"
                resolved_reference_mtime = resolved_reference.stat().st_mtime_ns
                terminate_process_group(process)
                self.assertNotEqual(process.returncode, 0)
                self.assertFalse((run_dir / "results" / "summary.json").exists())

                resumed = run_snakemake(
                    run_dir,
                    config_path,
                    "--rerun-incomplete",
                    env=fake_lifton_environment(bin_dir),
                )

                self.assertEqual(resumed.returncode, 0, resumed.stderr)
                summary = json.loads(
                    (run_dir / "results" / "summary.json").read_text(encoding="utf-8")
                )
                self.assertEqual(summary["status"], "completed")
                self.assertEqual(resolved_reference.stat().st_mtime_ns, resolved_reference_mtime)
                self.assertTrue((run_dir / "provenance" / "run.json").is_file())
            finally:
                terminate_process_group(process)


@unittest.skipUnless(SNAKEMAKE_BIN and CONDA_BIN, "snakemake and conda must be installed on PATH")
@unittest.skipUnless(
    RUN_CONDA_INTEGRATION,
    "set RUN_SNAKEMAKE_CONDA_INTEGRATION=1 to provision and test rule environments",
)
class CondaDeploymentExecutionTests(unittest.TestCase):
    """Exercises Snakemake's supported per-rule Conda deployment path.

    This opt-in test can download packages and is therefore kept separate
    from the dependency-free default test suite.
    """

    def test_full_pipeline_with_snakemake_managed_environments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = write_local_config(run_dir)

            result = run_snakemake(run_dir, config_path, "--use-conda")

            self.assertEqual(result.returncode, 0, result.stderr)
            validation = json.loads(
                (run_dir / "results" / "validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual(validation["status"], "passed")


@unittest.skipUnless(SNAKEMAKE_BIN, "snakemake is not installed on PATH")
@unittest.skipUnless(
    LIFTON_TOOLING_AVAILABLE, "lifton, miniprot, and minimap2 must all be installed on PATH"
)
class FullPipelineExecutionTests(unittest.TestCase):
    """Runs the real LiftOn stage end to end when lifton, miniprot, and
    minimap2 are available directly on PATH, for example while executing
    tests inside the environment pinned by `workflows/annotation-transfer/envs/lifton/environment.yaml`.
    CI installations without those scientific tools skip these tests."""

    def test_full_pipeline_on_the_synthetic_fixtures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "test-run"
            run_dir.mkdir(parents=True)
            config_path = write_local_config(run_dir)

            result = run_snakemake(run_dir, config_path)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((run_dir / "results" / "annotation" / "lifton.raw.gff3").is_file())
            diagnostics = run_dir / "results" / "annotation" / "lifton_output"
            self.assertTrue(diagnostics.is_dir())
            self.assertTrue((diagnostics / "liftoff" / "liftoff.gff3").is_file())
            self.assertTrue((diagnostics / "miniprot" / "miniprot.gff3").is_file())
            raw = (run_dir / "results" / "annotation" / "lifton.raw.gff3").read_text(
                encoding="utf-8"
            )
            self.assertIn("chr1\tLiftOn\tgene\t1031\t1430", raw)
            self.assertIn("chr2\tLiftOn\tgene\t831\t1130", raw)

            validation = json.loads(
                (run_dir / "results" / "validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual(validation["status"], "passed")

            details = run_dir / "results" / "feature-transfer.tsv"
            metrics_path = run_dir / "results" / "metrics.json"
            summary_path = run_dir / "results" / "summary.json"
            self.assertTrue(details.is_file())
            self.assertTrue(metrics_path.is_file())
            self.assertTrue(summary_path.is_file())
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(metrics["workflow"], {"id": "annotation-transfer", "version": 1})
            self.assertEqual(metrics["transfer"]["reference_features"], 2)
            self.assertEqual(metrics["transfer"]["mapped_features"], 2)
            self.assertEqual(summary["metrics"]["payload"], metrics)
            self.assertTrue(summary["source_evidence"]["raw_gff3"]["available"])

            artifacts = json.loads((run_dir / "artifacts.yaml").read_text(encoding="utf-8"))
            provenance = json.loads(
                (run_dir / "provenance" / "run.json").read_text(encoding="utf-8")
            )
            records = {record["id"]: record for record in artifacts["artifacts"]}
            self.assertIn("raw-gff3", records)
            self.assertEqual(records["resolved-reference-fasta"]["origin"], "imported")
            self.assertEqual(provenance["workflow"]["id"], "annotation-transfer")
            self.assertEqual(provenance["resources"]["effective_cpus"], 1)


if __name__ == "__main__":
    unittest.main()
