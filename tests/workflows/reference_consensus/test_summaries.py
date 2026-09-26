import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

artifacts = load_script("artifacts")
summarize_isolate = load_script("summarize_isolate")
collect_consensus_provenance = load_script("collect_consensus_provenance")


class ArtifactListTests(unittest.TestCase):
    def test_expands_every_read_pair_and_isolate_without_duplicate_paths(self) -> None:
        isolates = [{"id": "iso-a", "read_pairs": [{}]}, {"id": "iso-b", "read_pairs": [{}, {}]}]
        entries = artifacts.run_artifacts(isolates)
        paths = [entry["path"] for entry in entries]
        self.assertEqual(len(paths), len(set(paths)))
        self.assertIn("results/isolates/iso-b/pairs/2/fastp.json", paths)
        self.assertNotIn("results/isolates/iso-a/pairs/2/fastp.json", paths)
        self.assertTrue(all("{" not in path for path in paths))
        logs = [entry for entry in entries if entry["type"] == "log"]
        self.assertTrue(logs and not any(entry["declared"] for entry in logs))

    def test_records_a_missing_artifact_instead_of_failing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            present = Path(directory) / "present.txt"
            present.write_text("x", encoding="utf-8")
            record = artifacts.checksum_artifact({"id": "a", "path": str(present), "type": "text", "stage": "s"})
            self.assertEqual(record["size_bytes"], 1)
            missing = artifacts.checksum_artifact({"id": "b", "path": str(Path(directory) / "gone"), "type": "text",
                                                   "stage": "s"})
            self.assertEqual(missing["status"], "missing")


class SummarizeIsolateTests(unittest.TestCase):
    def test_names_the_trimming_of_all_read_pairs(self) -> None:
        self.assertEqual(summarize_isolate.trimmed_status([{"trimmed": False}]), "untrimmed")
        self.assertEqual(summarize_isolate.trimmed_status([{"trimmed": True}, {"trimmed": True}]), "trimmed")
        self.assertEqual(summarize_isolate.trimmed_status([{"trimmed": True}, {"trimmed": False}]), "partly-trimmed")


class RunProvenanceTests(unittest.TestCase):
    def test_collects_each_started_job_command_from_the_run_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            events = Path(directory) / "events.jsonl"
            events.write_text(
                "\n".join([
                    json.dumps({"type": "run-info", "jobs": {}}),
                    json.dumps({"type": "job-started", "timestamp": "t1", "rule": "align_read_pair",
                                "wildcards": {"isolate": "iso-a", "pair": "1"}, "outputs": ["a.bam"],
                                "command": "bwa mem ..."}),
                    "not json",
                    json.dumps({"type": "job-started", "timestamp": "t2", "rule": "all", "command": None}),
                ]) + "\n",
                encoding="utf-8",
            )
            commands = collect_consensus_provenance.job_commands(events)
        self.assertEqual(
            commands["jobs"],
            [{"timestamp": "t1", "rule": "align_read_pair", "wildcards": {"isolate": "iso-a", "pair": "1"},
              "outputs": ["a.bam"], "command": "bwa mem ..."}],
        )

    def test_reports_commands_as_unavailable_without_run_events(self) -> None:
        commands = collect_consensus_provenance.job_commands(Path("/nonexistent/events.jsonl"))
        self.assertEqual(commands["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
