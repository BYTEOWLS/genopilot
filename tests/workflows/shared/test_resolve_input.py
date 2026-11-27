import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ._load import load_script

resolve_input = load_script("resolve_input")


class ResolveInputTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def args(self, source, role="target"):
        args = [
            "--role", role, "--input-json", json.dumps(source),
            "--output-root", str(self.root / "cache-root"),
            "--fasta-destination", str(self.root / "resolved.fasta"),
            "--fasta-provenance", str(self.root / "fasta.json"),
        ]
        if role == "reference":
            args += ["--gff3-destination", str(self.root / "resolved.gff"),
                     "--gff3-provenance", str(self.root / "gff3.json")]
        return args

    def test_local_reference_and_backbone_keep_per_file_imported_provenance(self):
        fasta = self.root / "input.fasta"
        gff3 = self.root / "input.gff"
        fasta.write_text(">synthetic\nACGT\n")
        gff3.write_text("##gff-version 3\n")
        source = {"source": "local", "fasta": str(fasta), "gff3": str(gff3)}
        for role in ("reference", "backbone"):
            with self.subTest(role=role), patch.object(resolve_input, "copy_genome") as bridge:
                self.assertEqual(resolve_input.main(self.args(source, role)), 0)
                bridge.assert_not_called()
                self.assertEqual((self.root / "resolved.fasta").read_bytes(), fasta.read_bytes())
                record = json.loads((self.root / "fasta.json").read_text())
                self.assertEqual(record["origin"], "imported")
                self.assertEqual(record["path"], str(fasta))
                self.assertEqual(record["checksum"]["value"], resolve_input.sha256_file(fasta))
        self.assertEqual((self.root / "resolved.gff").read_bytes(), gff3.read_bytes())
        self.assertEqual(json.loads((self.root / "gff3.json").read_text())["path"], str(gff3))

    def test_remote_roles_forward_saved_references_and_required_files_to_bridge(self):
        reference = {"source": "test-provider", "id": "release-71", "parameters": {"release": 71}}
        copy = {"path": "/external/release-71", "fasta_sha256": "a" * 64, "gff3_sha256": "b" * 64}
        for role in ("reference", "target", "backbone"):
            for downloaded in (True, False):
                with self.subTest(role=role, downloaded=downloaded):
                    source = {"source": "remote", "reference": reference, "cache_mode": "reuse", "copy": copy}
                    genome = {
                        "reference": reference, "fasta": "/external/release-71/genomic.fna",
                        "gff3": "/external/release-71/genomic.gff",
                        "fasta_sha256": "a" * 64, "gff3_sha256": "b" * 64,
                        "facts": {"api": "test-rest"}, "metadata": None,
                        "resolver": {"node_version": "test-node"},
                        "annotation": "available", "downloaded": downloaded,
                    }
                    with patch.object(resolve_input, "copy_genome", return_value=genome) as bridge:
                        self.assertEqual(resolve_input.main(self.args(source, role)), 0)
                    request, destinations = bridge.call_args.args
                    kinds = ["fasta", "gff3"] if role == "reference" else ["fasta"]
                    self.assertEqual(request, {"reference": reference, "kinds": kinds,
                                              "root": str(self.root / "cache-root"), "mode": "reuse", "copy": copy})
                    self.assertEqual(list(destinations), kinds)
                    for kind in kinds:
                        record = json.loads((self.root / f"{kind}.json").read_text())
                        self.assertEqual(record["source"], reference["source"])
                        self.assertEqual(record["id"], reference["id"])
                        self.assertEqual(record["parameters"], reference["parameters"])
                        self.assertEqual(record["provider_facts"], genome["facts"])
                        self.assertEqual(record["resolver"], genome["resolver"])
                        self.assertEqual(record["downloaded"], downloaded)
                        self.assertEqual(record["origin"], "imported")
                        self.assertEqual(record["checksum"]["value"], genome[f"{kind}_sha256"])

    def test_bridge_failure_writes_no_success_provenance(self):
        source = {"source": "remote", "reference": {}, "cache_mode": "refresh"}
        with patch.object(resolve_input, "copy_genome", side_effect=RuntimeError("unavailable required annotation")):
            with self.assertRaisesRegex(RuntimeError, "annotation"):
                resolve_input.main(self.args(source, "reference"))
        self.assertFalse((self.root / "fasta.json").exists())
        self.assertFalse((self.root / "gff3.json").exists())
