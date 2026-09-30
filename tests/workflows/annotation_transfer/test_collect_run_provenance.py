import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

collect = load_script("collect_run_provenance")


class CollectRunProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_directory = Path.cwd()
        self.temporary = tempfile.TemporaryDirectory()
        self.temp_dir = Path(self.temporary.name)
        os.chdir(self.temp_dir)
        self.manifest = self.temp_dir / "manifest.yaml"
        self.manifest.write_text("schema_version: 1\nid: annotation-transfer\n", encoding="utf-8")
        self.config = {
            "schema_version": 1,
            "workflow_id": "annotation-transfer",
            "workflow_version": 1,
            "inputs": {
                "reference": {"source": "local", "fasta": "/inputs/reference.fasta", "gff3": "/inputs/reference.gff3"},
                "target": {"source": "local", "fasta": "/inputs/target.fasta"},
            },
            "lifton": {"profile": "same-species"},
            "resources": {"cpu_mode": "manual", "manual_limit": 3, "effective_cpus": 3},
            "run": {
                "output_root": str(self.temp_dir.parent),
                "id": "test-run",
                "created_at": "2026-09-05T20:00:00.000Z",
            },
        }
        self._create_inputs()

    def tearDown(self) -> None:
        os.chdir(self.previous_directory)
        self.temporary.cleanup()

    def _write(self, relative: str, content: str = "test\n") -> None:
        path = self.temp_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _create_inputs(self) -> None:
        for name in ("reference.fasta", "reference.gff3", "target.fasta"):
            self._write(f"resolved/{name}", f"resolved {name}\n")
            self._write(
                f"provenance/{name}.json",
                json.dumps(
                    {
                        "schema_version": 1,
                        "source": "local",
                        "path": f"/inputs/{name}",
                        "origin": "imported",
                        "checksum": {"algorithm": "sha256", "value": "source-checksum"},
                    }
                ),
            )
        generated = [
            "results/input-validation.json",
            "results/annotation/lifton.raw.gff3",
            "results/annotation/lifton_output/run_manifest.json",
            "results/validation.json",
            "results/feature-transfer.tsv",
            "results/metrics.json",
            "results/summary.json",
            "logs/resolve-reference.log",
            "logs/resolve-target.log",
            "logs/validate-inputs.log",
            "logs/transfer-annotation.log",
            "logs/transfer-annotation.benchmark.tsv",
            "logs/validate-annotation.log",
            "logs/summarize-results.log",
            "logs/record-provenance.log",
        ]
        for relative in generated:
            self._write(relative, relative + "\n")

    def _run(self) -> tuple[dict, dict]:
        original = collect.observed_tool_versions
        collect.observed_tool_versions = lambda: {
            "lifton": {"version": "1.2.3", "source": "installed-package"}
        }
        try:
            result = collect.main(
                [
                    "--config-json",
                    json.dumps(self.config),
                    "--manifest",
                    str(self.manifest),
                    "--manifest-schema-version",
                    "1",
                    "--snakemake-version",
                    "9.11.3",
                    "--snakemake-python-version",
                    "3.13.15",
                    "--artifacts",
                    "artifacts.yaml",
                    "--provenance",
                    "provenance/run.json",
                ]
            )
        finally:
            collect.observed_tool_versions = original
        self.assertEqual(result, 0)
        return (
            json.loads(Path("artifacts.yaml").read_text(encoding="utf-8")),
            json.loads(Path("provenance/run.json").read_text(encoding="utf-8")),
        )

    def test_writes_checksummed_artifact_and_run_records(self) -> None:
        artifacts, provenance = self._run()
        records = {record["id"]: record for record in artifacts["artifacts"]}

        raw = records["raw-gff3"]
        self.assertEqual(raw["origin"], "generated")
        self.assertEqual(raw["producer"]["workflow"], {"id": "annotation-transfer", "version": 1})
        configured = collect.configured_tool_versions()
        self.assertEqual(raw["producer"]["tools"]["lifton"], configured["lifton"])
        # Rules without a Conda environment ran on Snakemake's interpreter, not an environment's.
        self.assertEqual(records["input-validation"]["producer"]["tools"], {"snakemake-python": "3.13.15"})
        self.assertEqual(
            provenance["tool_versions"]["observed"]["snakemake-python"],
            {"version": "3.13.15", "source": "workflow-runtime"},
        )
        self.assertEqual(
            raw["checksum"]["value"],
            hashlib.sha256(Path(raw["path"]).read_bytes()).hexdigest(),
        )
        self.assertEqual(records["resolved-reference-fasta"]["origin"], "imported")
        self.assertEqual(
            records["resolved-reference-fasta"]["source_provenance"],
            "provenance/reference.fasta.json",
        )
        self.assertGreater(records["lifton-diagnostics"]["file_count"], 0)
        self.assertEqual(
            artifacts["workflow"]["manifest_checksum"]["value"],
            hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
        )

        self.assertEqual(provenance["effective_configuration"], self.config)
        self.assertEqual(provenance["resources"]["requested"]["manual_limit"], 3)
        self.assertEqual(provenance["resources"]["effective_cpus"], 3)
        self.assertEqual(provenance["tool_versions"]["configured"], configured)
        self.assertEqual(provenance["tool_versions"]["observed"]["snakemake"]["version"], "9.11.3")
        self.assertTrue(all("argv" in command for command in provenance["commands"]))
        transfer = next(item for item in provenance["commands"] if item["rule"] == "transfer_annotation")
        self.assertEqual(transfer["argv"][-1], "3")
        self.assertEqual(
            provenance["artifact_index"]["checksum"]["value"],
            hashlib.sha256(Path("artifacts.yaml").read_bytes()).hexdigest(),
        )


class DirectoryChecksumTests(unittest.TestCase):
    def test_directory_checksum_includes_relative_names_and_contents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            (temp_dir / "a").mkdir()
            (temp_dir / "a" / "report.txt").write_text("one", encoding="utf-8")
            first = collect.sha256_directory(temp_dir)
            (temp_dir / "a" / "report.txt").write_text("two", encoding="utf-8")
            second = collect.sha256_directory(temp_dir)
            self.assertNotEqual(first[0], second[0])
            self.assertEqual(second[1:], (1, 3))


if __name__ == "__main__":
    unittest.main()


class ConfiguredToolVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.envs = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _environment(self, name: str, content: str) -> None:
        directory = self.envs / name
        directory.mkdir()
        (directory / "environment.yaml").write_text(content, encoding="utf-8")

    def test_reads_conda_and_pip_pins_from_every_environment(self) -> None:
        self._environment(
            "aligner",
            "name: aligner\nchannels:\n  - conda-forge\n  - bioconda\ndependencies:\n"
            "  - python=3.11.16\n  - minimap2=2.31  # aligner\n  - pip\n  - pip:\n      - tool==1.2.3\n",
        )
        self._environment("fetch", "dependencies:\n  - python=3.11.16\n  - fetcher=18.0.0\n")

        self.assertEqual(
            collect.configured_tool_versions(self.envs),
            {"python": "3.11.16", "minimap2": "2.31", "tool": "1.2.3", "fetcher": "18.0.0"},
        )

    def test_rejects_a_package_pinned_differently_across_environments(self) -> None:
        self._environment("one", "dependencies:\n  - python=3.11.16\n")
        self._environment("two", "dependencies:\n  - python=3.12.1\n")

        with self.assertRaises(ValueError):
            collect.configured_tool_versions(self.envs)

    def test_packaged_environments_pin_every_recorded_stage_tool(self) -> None:
        configured = collect.configured_tool_versions()

        for name in ("python", "lifton", "miniprot", "minimap2", "parasail-python", "ncbi-datasets-cli"):
            self.assertIn(name, configured)
