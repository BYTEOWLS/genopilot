"""Opt-in live NCBI evidence, separate from the provider-independent resolver tests.

Build first, put the pinned Snakemake on PATH, then run with
RUN_NCBI_DOWNLOAD_INTEGRATION=1. Only input resolution runs; no Conda tools.
Downloaded public files live in temporary directories, never repository fixtures.
"""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ._load import PROJECT_ROOT
from ..annotation_transfer.test_snakefile_direct_execution import write_local_config
from ..reference_consensus.fixtures import write_run

SNAKEMAKE = shutil.which("snakemake")
NODE = os.environ.get("GENOPILOT_NODE_EXECUTABLE") or shutil.which("node")
LIVE = os.environ.get("RUN_NCBI_DOWNLOAD_INTEGRATION") == "1"
# Small public annotated bacterial assembly; this is NCBI evidence, not a shared default.
REFERENCE = {"source": "ncbi", "id": "GCF_000005845.2", "parameters": {}}


@unittest.skipUnless(LIVE, "set RUN_NCBI_DOWNLOAD_INTEGRATION=1 for live NCBI downloads")
@unittest.skipUnless(SNAKEMAKE and NODE and (PROJECT_ROOT / "dist/genome-source.js").is_file(),
                     "build the resolver and provide the pinned Snakemake and Node")
class NcbiCacheMissIntegrationTests(unittest.TestCase):
    def test_direct_workflows_download_on_cache_miss_then_reuse_verified_files(self) -> None:
        for role in ("reference", "target", "backbone"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                run = root / "runs" / "run"
                run.mkdir(parents=True)
                unrelated = root / "unrelated"
                unrelated.mkdir()
                home = root / "home"
                home.mkdir()
                workflow = "reference-consensus" if role == "backbone" else "annotation-transfer"
                remote = {"source": "remote", "reference": REFERENCE, "cache_mode": "reuse"}
                if role == "backbone":
                    config = write_run(run, ["iso-a"])
                    configuration = json.loads(config.read_text())
                    configuration["inputs"][role] = remote
                    config.write_text(json.dumps(configuration))
                else:
                    config = write_local_config(run)
                    text = config.read_text()
                    start, end = text.index(f"  {role}:\n"), text.index("lifton:\n")
                    if role == "reference":
                        end = text.index("  target:\n", start)
                    config.write_text(text[:start] + f"  {role}: " + json.dumps(remote) + "\n" + text[end:])
                cache = run.parent / "ncbi-accessions-cache" / REFERENCE["id"]
                self.assertFalse(cache.exists())
                kinds = ("fasta", "gff3") if role == "reference" else ("fasta",)
                command = [
                    SNAKEMAKE, "--snakefile", str(PROJECT_ROOT / "workflows" / workflow / "Snakefile"),
                    "--directory", str(run), "--configfile", str(config), "--cores", "1",
                    *[f"resolved/{role}.{kind}" for kind in kinds],
                ]
                env = {**os.environ, "HOME": str(home), "GENOPILOT_NODE_EXECUTABLE": NODE}
                first = subprocess.run(command, cwd=unrelated, env=env, capture_output=True, text=True)
                self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
                checksums = json.loads((cache / "checksums.json").read_text())
                self.assertEqual(set(checksums), set(kinds))
                record = json.loads((cache / "genome.json").read_text())
                self.assertEqual(record["reference"], REFERENCE)
                for kind in kinds:
                    provenance = json.loads((run / f"provenance/{role}.{kind}.json").read_text())
                    checksum = hashlib.sha256((run / f"resolved/{role}.{kind}").read_bytes()).hexdigest()
                    self.assertTrue(provenance["downloaded"])
                    self.assertEqual(provenance["origin"], "imported")
                    self.assertEqual(provenance["checksum"]["value"], checksum)
                    self.assertEqual(checksums[kind], checksum)
                    self.assertEqual(provenance["source"], REFERENCE["source"])
                    self.assertEqual(provenance["id"], REFERENCE["id"])
                    self.assertEqual(provenance["provider_facts"]["api"], "datasets-v2-rest")
                # Remove consumers, not cache files or timestamps, to exercise a real second resolution.
                for kind in kinds:
                    (run / f"resolved/{role}.{kind}").unlink()
                second = subprocess.run(command, cwd=unrelated, env=env, capture_output=True, text=True)
                self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
                for kind in kinds:
                    provenance = json.loads((run / f"provenance/{role}.{kind}.json").read_text())
                    self.assertFalse(provenance["downloaded"])
                    self.assertEqual(provenance["checksum"]["value"], checksums[kind])
                self.assertEqual(sorted(path.name for path in cache.parent.iterdir()), [REFERENCE["id"]])


if __name__ == "__main__":
    unittest.main()
