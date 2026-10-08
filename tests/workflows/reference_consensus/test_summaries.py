import json
import os
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

artifacts = load_script("artifacts")
summarize_isolate = load_script("summarize_isolate")
collect_consensus_provenance = load_script("collect_consensus_provenance")
collect_iteration_provenance = load_script("collect_iteration_provenance")


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



class IterationProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.run_dir = Path(tmp.name)
        cwd = os.getcwd()
        os.chdir(self.run_dir)
        self.addCleanup(os.chdir, cwd)

    def write(self, path: str, content: str = "x") -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(content, encoding="utf-8")

    def test_records_voters_excluded_isolates_and_only_the_iteration_jobs(self) -> None:
        config = {
            "workflow_id": "reference-consensus",
            "workflow_version": 1,
            "genopilot": {"version": "1.2.3", "igv": "3.8.9"},
            "inputs": {"selected_isolates": ["iso-a", "iso-b", "iso-c"]},
            "run": {"id": "run-a", "created_at": "2026-09-25T10:00:00.000Z"},
        }
        settings = {"include_backbone_vote": False, "voting_method": "plurality", "min_callable_isolates": 1,
                    "unresolved_snp": "n"}
        self.write("decisions/iteration-2.yaml", "reason: test\n")
        self.write("manifest.yaml")
        self.write("resolved/backbone.fasta", ">chr1\nACGT\n")
        self.write("provenance/backbone.fasta.json", json.dumps({"origin": "imported"}))
        self.write("results/cohort/iteration-2/consensus-summary.json", json.dumps({**settings, "voters": ["iso-a"]}))
        for name in ("variants.vcf.gz", "variants.vcf.gz.csi", "callable-mask.bed"):
            self.write(f"results/isolates/iso-a/{name}")
        self.write("results/isolates/iso-a/provenance.json", json.dumps(
            {"tool_versions": {"samtools": {"version": "1.24", "source": "executable"}}}))
        # iso-b finished and was excluded by choice; iso-c failed before its promotion candidate.
        self.write("results/isolates/iso-b/promotion-candidate.json", "{}")
        self.write("events.jsonl", "\n".join(json.dumps(event) for event in (
            {"type": "job-started", "rule": "aggregate_support", "outputs": ["results/cohort/initial/support-summary.json"]},
            {"type": "job-started", "rule": "generate_consensus",
             "outputs": ["results/cohort/iteration-2/consensus-summary.json"], "command": "python3 generate"},
        )))

        collect_iteration_provenance.main([
            "--config-json", json.dumps(config), "--cohort", "iteration-2",
            "--decision", "decisions/iteration-2.yaml", "--manifest", "manifest.yaml",
            "--manifest-schema-version", "1", "--snakemake-version", "9.0.0",
            "--snakemake-python-version", "3.13.15", "--provenance", "provenance/cohort/iteration-2.json",
        ])

        record = json.loads(Path("provenance/cohort/iteration-2.json").read_text(encoding="utf-8"))
        # An iteration records the GenoPilot that saved the configuration, not the one running it.
        self.assertEqual(record["genopilot"], {"version": "1.2.3", "igv": "3.8.9"})
        self.assertEqual(record["consensus"], settings)
        self.assertEqual(sorted(record["voting_isolates"]), ["iso-a"])
        self.assertTrue(all("checksum" in entry for entry in record["voting_isolates"]["iso-a"]["inputs"]))
        self.assertEqual(record["excluded_isolates"], {"iso-b": {"processing": "completed"},
                                                       "iso-c": {"processing": "incomplete"}})
        self.assertFalse(record["initial_cohort"]["aggregated"])
        self.assertEqual(record["backbone"]["origin"], "imported")
        self.assertEqual(record["tool_versions"]["observed"]["samtools"]["version"], "1.24")
        self.assertEqual(record["tool_versions"]["observed"]["snakemake"]["version"], "9.0.0")
        self.assertEqual([job["rule"] for job in record["commands"]["jobs"]], ["generate_consensus"])
        paths = {entry["path"]: entry for entry in record["artifacts"]}
        self.assertIn("checksum", paths["results/cohort/iteration-2/consensus-summary.json"])
        self.assertEqual(paths["results/cohort/iteration-2/consensus.fasta"]["status"], "missing")
        self.assertTrue(all("/initial/" not in path for path in paths))


if __name__ == "__main__":
    unittest.main()
