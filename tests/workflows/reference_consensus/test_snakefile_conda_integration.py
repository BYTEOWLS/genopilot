"""Runs reference-consensus with its real, Snakemake-provisioned tools on the fixtures.

Opt-in, because provisioning the pinned environments downloads packages:
set RUN_SNAKEMAKE_CONDA_INTEGRATION=1 and put the pinned `snakemake` and
`conda` on PATH. The environments are provisioned once per test class into a
temporary Conda prefix, and one complete run is shared by the assertions.
"""

import gzip
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ._load import WORKFLOW_DIR
from .fixtures import EXPECTED, write_run

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

    def pass_variants(self, isolate: str) -> set[tuple[str, int, str, str]]:
        variants = set()
        path = self.run_dir / "results" / "isolates" / isolate / "variants.vcf.gz"
        with gzip.open(path, "rt", encoding="utf-8") as vcf:
            for line in vcf:
                if not line.startswith("#"):
                    chrom, position, _, ref, alt, _, status = line.split("\t")[:7]
                    if status == "PASS":
                        variants.add((chrom, int(position), ref, alt))
        return variants

    def mask_state(self, isolate: str, chrom: str, position: int) -> str:
        path = self.run_dir / "results" / "isolates" / isolate / "callable-mask.bed"
        for line in path.read_text(encoding="utf-8").splitlines():
            name, start, end, state = line.split("\t")
            if name == chrom and int(start) < position <= int(end):
                return state
        raise AssertionError(f"{chrom}:{position} is not in the mask")

    def test_pass_variants_are_exactly_the_simulated_ones(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        for isolate, truth in EXPECTED["isolates"].items():
            with self.subTest(isolate=isolate):
                expected = {(v["contig"], v["position"], v["ref"], v["alt"]) for v in truth["variants"]}
                self.assertEqual(self.pass_variants(isolate), expected)

    def test_the_mask_marks_simulated_ambiguous_and_uncallable_positions(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        for isolate, truth in EXPECTED["isolates"].items():
            for state, probes in truth["probes"].items():
                for probe in probes:
                    with self.subTest(isolate=isolate, state=state, **probe):
                        self.assertEqual(self.mask_state(isolate, probe["contig"], probe["position"]), state)
            for variant in truth["variants"]:
                with self.subTest(isolate=isolate, variant=variant["position"]):
                    self.assertEqual(self.mask_state(isolate, variant["contig"], variant["position"]), "callable")

    def test_temporary_trimmed_reads_and_pair_alignments_are_removed(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        pair_dir = self.run_dir / "results" / "isolates" / "iso-b" / "pairs" / "2"
        self.assertTrue((pair_dir / "fastp.json").is_file())
        self.assertFalse((pair_dir / "trimmed_R1.fastq.gz").exists())
        self.assertFalse((pair_dir / "aligned.bam").exists())
        self.assertFalse((self.run_dir / "results" / "isolates" / "iso-b" / "markdup-work").exists())


if __name__ == "__main__":
    unittest.main()
