import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ._load import load_script

preprocess_reads = load_script("preprocess_reads")
read_sets = load_script("read_sets")

SETTINGS = {"poly_g": True, "poly_g_min_length": 10, "minimum_length": 30,
            "quality_filtering": False, "paired_adapter_detection": True, "poly_g_source": "chemistry"}


class PreprocessReadsTests(unittest.TestCase):
    def test_options_explicitly_disable_auto_detection_when_off(self):
        enabled = preprocess_reads.fastp_options(SETTINGS)
        self.assertIn("--trim_poly_g", enabled)
        disabled = preprocess_reads.fastp_options({**SETTINGS, "poly_g": False})
        self.assertNotIn("--trim_poly_g", disabled)
        self.assertIn("--disable_trim_poly_g", disabled)
        self.assertIn("--disable_quality_filtering", disabled)
        self.assertIn("--detect_adapter_for_pe", disabled)

    def test_provider_trimmed_inputs_skip_fastp_and_keep_actual_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            r1, r2 = root / "r1.fq", root / "r2.fq"
            r1.write_bytes(b"@read/1\nACGT\n+\nIIII\n")
            r2.write_bytes(b"@read/2\nACGT\n+\nIIII\n")
            pair = {"r1": str(r1), "r2": str(r2), "trimmed": True, "preprocessing": SETTINGS}
            with patch.object(preprocess_reads.subprocess, "run") as runner:
                preprocess_reads.preprocess(pair, root / "out", 2)
                runner.assert_not_called()
            self.assertEqual((root / "out/trimmed_R1.fastq.gz").read_bytes(), r1.read_bytes())
            report = json.loads((root / "out/fastp.json").read_text())
            self.assertEqual(report["status"], "skipped-provider-trimmed")
            self.assertEqual(report["origin"], "imported")
            self.assertIsNone(report["summary"]["before_filtering"])

    def test_unprocessed_inputs_invoke_the_recorded_command_and_propagate_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            pair = {"r1": "/reads/r1.fq", "r2": "/reads/r2.fq", "trimmed": False, "preprocessing": SETTINGS}
            with patch.object(preprocess_reads.subprocess, "run") as runner:
                preprocess_reads.preprocess(pair, Path(temp), 3)
                command = runner.call_args.args[0]
                self.assertEqual(command[0], "fastp")
                self.assertIn("--trim_poly_g", command)
                self.assertEqual(command[-2:], ["--thread", "3"])
                self.assertTrue(runner.call_args.kwargs["check"])
            with patch.object(preprocess_reads.subprocess, "run", side_effect=RuntimeError("failed")):
                with self.assertRaises(RuntimeError):
                    preprocess_reads.preprocess(pair, Path(temp), 3)

    def test_projection_preserves_shared_libraries_and_unique_groups_across_sets(self):
        isolate = {"id": "sample", "read_sets": [
            {"id": set_id, "library_id": "shared", "platform": "illumina", "layout": "paired-end",
             "effective_preprocessing": SETTINGS, "read_pairs": [{"r1": "a", "r2": "b", "trimmed": False}] * 2}
            for set_id in ("delivery", "topup")]}
        pairs = read_sets.execution_pairs(isolate)
        self.assertEqual(len(pairs), 4)
        self.assertEqual(len({pair["read_group_id"] for pair in pairs}), 4)
        self.assertEqual({pair["library_id"] for pair in pairs}, {"shared"})
