"""Runs reference-consensus with its real, Snakemake-provisioned tools on the fixtures.

Opt-in, because provisioning the pinned environments downloads packages:
set RUN_SNAKEMAKE_CONDA_INTEGRATION=1 and put the pinned `snakemake` and
`conda` on PATH. The environments are provisioned once per test class into a
temporary Conda prefix, and one complete run is shared by the assertions.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ._load import WORKFLOW_DIR
from .fixtures import write_run

SNAKEMAKE_BIN = shutil.which("snakemake")
CONDA_BIN = shutil.which("conda")
RUN_CONDA_INTEGRATION = os.environ.get("RUN_SNAKEMAKE_CONDA_INTEGRATION") == "1"


def run_snakemake(run_dir: Path, conda_prefix: Path, *extra_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            SNAKEMAKE_BIN,
            "--snakefile", str(WORKFLOW_DIR / "Snakefile"),
            "--directory", str(run_dir),
            "--configfile", str(run_dir / "config.yaml"),
            "--cores", "4",
            "--use-conda",
            "--conda-prefix", str(conda_prefix),
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )


@unittest.skipUnless(SNAKEMAKE_BIN and CONDA_BIN, "snakemake and conda must be installed on PATH")
@unittest.skipUnless(
    RUN_CONDA_INTEGRATION,
    "set RUN_SNAKEMAKE_CONDA_INTEGRATION=1 to provision and test rule environments",
)
class ReferenceConsensusCondaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name)
        cls.conda_prefix = cls.root / "conda-envs"
        cls.run_dir = cls.root / "runs" / "complete-run"
        write_run(cls.run_dir, ["iso-a", "iso-b", "iso-c"], effective_cpus=4)
        cls.result = run_snakemake(cls.run_dir, cls.conda_prefix)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def isolate_json(self, isolate: str, name: str) -> dict:
        return json.loads((self.run_dir / "results" / "isolates" / isolate / name).read_text(encoding="utf-8"))

    def test_the_complete_run_succeeds(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)

    def test_duplicates_are_marked_across_runs_of_one_library_only(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        one_library = self.isolate_json("iso-b", "markdup.json")["libraries"]
        self.assertEqual(len(one_library), 1)
        self.assertEqual(len(one_library[0]["read_groups"]), 2)
        # The 40 fragments sequenced in both runs: one read pair of each is a duplicate.
        self.assertGreaterEqual(one_library[0]["markdup"]["DUPLICATE PAIR"], 80)

        two_libraries = self.isolate_json("iso-c", "markdup.json")["libraries"]
        self.assertEqual(len(two_libraries), 2)
        # The same 40 fragments in two libraries are not duplicates of each other; only
        # fragments that happen to coincide within one library may be marked.
        self.assertLess(sum(library["markdup"]["DUPLICATE PAIR"] for library in two_libraries), 20)

    def test_temporary_trimmed_reads_and_pair_alignments_are_removed(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        pair_dir = self.run_dir / "results" / "isolates" / "iso-b" / "pairs" / "2"
        self.assertTrue((pair_dir / "fastp.json").is_file())
        self.assertFalse((pair_dir / "trimmed_R1.fastq.gz").exists())
        self.assertFalse((pair_dir / "aligned.bam").exists())
        self.assertFalse((self.run_dir / "results" / "isolates" / "iso-b" / "markdup-work").exists())


if __name__ == "__main__":
    unittest.main()
