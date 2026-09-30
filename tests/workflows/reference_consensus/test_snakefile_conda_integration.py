"""Runs reference-consensus with its real, Snakemake-provisioned tools on the fixtures.

Opt-in, because provisioning the pinned environments downloads packages:
set RUN_SNAKEMAKE_CONDA_INTEGRATION=1 and put the pinned `snakemake` and
`conda` on PATH. The environments are provisioned once per test class into a
temporary Conda prefix, and one complete run is shared by the assertions.
"""

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ._load import WORKFLOW_DIR
from .fixtures import EXPECTED, write_decision, write_run

SNAKEMAKE_BIN = shutil.which("snakemake")
CONDA_BIN = shutil.which("conda")
RUN_CONDA_INTEGRATION = os.environ.get("RUN_SNAKEMAKE_CONDA_INTEGRATION") == "1"


COHORT_RULES = {"aggregate_support", "generate_consensus", "record_iteration_provenance"}


def planned_rules(dry_run: subprocess.CompletedProcess) -> set[str]:
    return set(re.findall(r"^rule (\w+):", dry_run.stdout, re.MULTILINE))


def checksums(directory: Path) -> dict[str, str]:
    return {
        path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.rglob("*")) if path.is_file()
    }


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
        cls.temp_dir = Path(cls._tmp.name)
        cls.conda_prefix = cls.temp_dir / "conda-envs"
        cls.run_dir = cls.temp_dir / "runs" / "complete-run"
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

    def test_every_isolate_has_a_promotion_candidate_matching_its_fasta(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        for isolate in EXPECTED["isolates"]:
            with self.subTest(isolate=isolate):
                candidate = self.isolate_json(isolate, "promotion-candidate.json")
                self.assertEqual(candidate["isolate_id"], isolate)
                fasta = self.run_dir / candidate["fasta"]["path"]
                self.assertEqual(candidate["fasta"]["sha256"], hashlib.sha256(fasta.read_bytes()).hexdigest())
                self.assertEqual(
                    candidate["backbone"]["sha256"],
                    hashlib.sha256((self.run_dir / "resolved" / "backbone.fasta").read_bytes()).hexdigest(),
                )
                bases = "".join(
                    line.strip() for line in fasta.read_text(encoding="utf-8").splitlines() if not line.startswith(">")
                )
                self.assertLessEqual(set(bases), set("ACGTN"))

    def test_the_run_records_its_artifacts_and_provenance(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        artifacts = json.loads((self.run_dir / "artifacts.yaml").read_text(encoding="utf-8"))["artifacts"]
        self.assertEqual([entry["path"] for entry in artifacts if entry.get("status") == "missing"], [])
        backbone = next(entry for entry in artifacts if entry["id"] == "resolved-backbone")
        self.assertEqual(backbone["origin"], "imported")
        provenance = json.loads((self.run_dir / "provenance" / "run.json").read_text(encoding="utf-8"))
        configured = provenance["tool_versions"]["configured"]
        observed = provenance["tool_versions"]["observed"]
        for tool in ("fastp", "samtools", "bcftools"):
            self.assertEqual(observed[tool]["version"], configured[tool], tool)
        self.assertTrue(observed["bwa"]["version"].startswith(configured["bwa"]))
        self.assertEqual(sorted(provenance["inputs"]["read_pairs"]), ["iso-a", "iso-b", "iso-c"])

    def test_a_threshold_change_reruns_calling_but_not_alignment(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        config_path = self.run_dir / "config.yaml"
        original = config_path.read_text(encoding="utf-8")
        self.addCleanup(config_path.write_text, original, encoding="utf-8")
        config = json.loads(original)
        config["calling"]["min_depth"] = 12
        config_path.write_text(json.dumps(config), encoding="utf-8")

        dry_run = run_snakemake(self.run_dir, self.conda_prefix, "--dry-run")
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
        planned = dry_run.stdout
        self.assertIn("classify_callability", planned)
        self.assertIn("filter_normalize_variants", planned)
        for rule in ("validate_read_pair", "trim_read_pair", "align_read_pair", "mark_duplicates"):
            self.assertNotIn(f"rule {rule}:", planned, rule)

    def support_rows(self, name: str) -> list[dict[str, str]]:
        path = self.run_dir / "results" / "cohort" / "initial" / f"support-{name}.tsv.gz"
        self.assertTrue(Path(f"{path}.tbi").is_file())
        with gzip.open(path, "rt", encoding="utf-8") as table:
            lines = table.read().splitlines()
        header = next(line for line in lines if not line.startswith("##")).lstrip("#").split("\t")
        return [dict(zip(header, line.split("\t"))) for line in lines if not line.startswith("#")]

    def test_support_counts_one_vote_per_callable_voter_at_every_variant(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        sites = {(row["chrom"], int(row["start"])): row for row in self.support_rows("sites")}
        expected = {
            # iso-a and iso-b carry T; the backbone and the callable iso-c vote G.
            ("chr1", 1100): ("chr1", "1100", "G,T", "2,2", "snp"),
            ("chr1", 1500): ("chr1", "1500", "G,A", "2,2", "snp"),
            # iso-a A, iso-c T, the backbone and iso-b C.
            ("chr2", 300): ("chr2", "300", "C,A,T", "2,1,1", "snp,multiallelic"),
            ("chr1", 1800): ("chr1", "1800", "G,GGAT", "3,1", "indel"),
            ("chr1", 2200): ("chr1", "2204", "ATCCT,A", "3,1", "indel"),
        }
        for key, (chrom, end, alleles, votes, flags) in expected.items():
            with self.subTest(site=key):
                row = sites[key]
                self.assertEqual((row["chrom"], row["end"], row["alleles"], row["allele_votes"], row["flags"]),
                                 (chrom, end, alleles, votes, flags))
        simulated = {(v["contig"], v["position"]) for truth in EXPECTED["isolates"].values() for v in truth["variants"]}
        self.assertEqual(set(sites), simulated)

    def test_only_the_backbone_votes_inside_the_repeat(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        repeat = EXPECTED["repeat"]["copy"]
        middle = (repeat["start"] + repeat["end"]) // 2
        row = next(
            row for row in self.support_rows("intervals")
            if row["chrom"] == repeat["contig"] and int(row["start"]) <= middle <= int(row["end"])
        )
        self.assertEqual((row["backbone_votes"], row["callable_isolates"], row["states"]), ("1", "0", "uuu"))
        summary = json.loads(
            (self.run_dir / "results" / "cohort" / "initial" / "support-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["voters"], ["iso-a", "iso-b", "iso-c"])
        self.assertTrue(summary["include_backbone_vote"])

    def consensus_rows(self) -> dict[tuple[str, int], dict[str, str]]:
        path = self.run_dir / "results" / "cohort" / "initial" / "consensus-sites.tsv.gz"
        self.assertTrue(Path(f"{path}.tbi").is_file())
        with gzip.open(path, "rt", encoding="utf-8") as table:
            lines = table.read().splitlines()
        header = next(line for line in lines if not line.startswith("##")).lstrip("#").split("\t")
        rows = [dict(zip(header, line.split("\t"))) for line in lines if not line.startswith("#")]
        return {(row["chrom"], int(row["start"])): row for row in rows if row["kind"] == "locus"}

    def test_the_consensus_decides_every_simulated_locus_by_strict_majority(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        rows = self.consensus_rows()
        expected = {
            ("chr1", 1100): ("unresolved", "tie", "N"),          # G=2, T=2
            ("chr1", 1500): ("unresolved", "tie", "N"),          # G=2, A=2
            ("chr2", 300): ("unresolved", "no_majority", "N"),   # C=2, A=1, T=1
            ("chr1", 1800): ("selected", ".", "G"),              # G=3, GGAT=1
            ("chr1", 2200): ("selected", ".", "ATCCT"),          # ATCCT=3, A=1
            ("chr1", 2500): ("selected", ".", "G"),              # only iso-b carries T
            ("chr2", 400): ("selected", ".", "A"),               # only iso-b carries G
        }
        self.assertEqual(set(rows), set(expected))
        for key, (status, reason, written) in expected.items():
            with self.subTest(site=key):
                row = rows[key]
                self.assertEqual((row["status"], row["reason"], row["written"]), (status, reason, written))
        consensus = self.run_dir / "results" / "cohort" / "initial" / "consensus.fasta"
        names = [line.split("\t")[0] for line in Path(f"{consensus}.fai").read_text(encoding="utf-8").splitlines()]
        backbone = self.run_dir / "resolved" / "backbone.fasta.fai"
        self.assertEqual(names, [line.split("\t")[0] for line in backbone.read_text(encoding="utf-8").splitlines()])
        summary = json.loads(consensus.with_name("consensus-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["voting_method"], "strict-majority")
        self.assertEqual(summary["loci"]["selected"], 4)
        self.assertEqual(summary["loci"]["unresolved"], {"tie": 2, "no_majority": 1, "no_votes": 0, "few_callable": 0})
        self.assertGreater(summary["bases"]["backbone_only"], 0)  # the repeat

    def test_a_voting_change_reruns_only_consensus_generation_or_aggregation(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        config_path = self.run_dir / "config.yaml"
        original = config_path.read_text(encoding="utf-8")
        self.addCleanup(config_path.write_text, original, encoding="utf-8")

        config = json.loads(original)
        for key, value in (("voting_method", "plurality"), ("min_callable_isolates", 1), ("unresolved_snp", "iupac")):
            changed = json.loads(original)
            changed["consensus"][key] = value
            config_path.write_text(json.dumps(changed), encoding="utf-8")
            consensus_only = run_snakemake(self.run_dir, self.conda_prefix, "--dry-run")
            with self.subTest(setting=key):
                self.assertEqual(consensus_only.returncode, 0, consensus_only.stderr)
                self.assertIn("rule generate_consensus:", consensus_only.stdout)
                self.assertNotIn("rule aggregate_support:", consensus_only.stdout)

        config["consensus"]["include_backbone_vote"] = False
        config_path.write_text(json.dumps(config), encoding="utf-8")
        backbone_vote = run_snakemake(self.run_dir, self.conda_prefix, "--dry-run")
        self.assertEqual(backbone_vote.returncode, 0, backbone_vote.stderr)
        self.assertIn("rule aggregate_support:", backbone_vote.stdout)
        for rule in ("call_all_sites", "classify_callability", "filter_normalize_variants", "build_isolate_consensus"):
            self.assertNotIn(f"rule {rule}:", backbone_vote.stdout, rule)

    def test_an_iteration_reruns_only_the_cohort_and_keeps_the_initial_result(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        initial = self.run_dir / "results" / "cohort" / "initial"
        before = checksums(initial)
        target = write_decision(self.run_dir, 2, ["iso-a", "iso-c"], ["iso-b"], {"voting_method": "plurality"})

        dry_run = run_snakemake(self.run_dir, self.conda_prefix, "--dry-run", target)
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
        self.assertEqual(planned_rules(dry_run), COHORT_RULES)
        result = run_snakemake(self.run_dir, self.conda_prefix, target)
        self.assertEqual(result.returncode, 0, result.stderr)

        self.assertEqual(checksums(initial), before)
        summary = json.loads((self.run_dir / "results/cohort/iteration-2/consensus-summary.json")
                             .read_text(encoding="utf-8"))
        self.assertEqual((summary["voters"], summary["voting_method"]), (["iso-a", "iso-c"], "plurality"))
        provenance = json.loads((self.run_dir / target).read_text(encoding="utf-8"))
        self.assertEqual(provenance["excluded_isolates"], {"iso-b": {"processing": "completed"}})
        self.assertTrue(provenance["initial_cohort"]["aggregated"])
        self.assertEqual([entry["path"] for entry in provenance["artifacts"] if entry.get("status") == "missing"], [])
        tools = provenance["tool_versions"]
        self.assertEqual(tools["observed"]["samtools"]["version"], tools["configured"]["samtools"])

        # A later decision reuses every per-isolate artifact again and leaves iteration 2 alone.
        iteration_two = checksums(self.run_dir / "results" / "cohort" / "iteration-2")
        later = write_decision(self.run_dir, 3, ["iso-b", "iso-c"], ["iso-a"])
        later_dry_run = run_snakemake(self.run_dir, self.conda_prefix, "--dry-run", later)
        self.assertEqual(later_dry_run.returncode, 0, later_dry_run.stderr)
        self.assertEqual(planned_rules(later_dry_run), COHORT_RULES)
        self.assertEqual(checksums(self.run_dir / "results" / "cohort" / "iteration-2"), iteration_two)

    def test_excluding_a_failed_isolate_completes_the_run_without_reprocessing_the_others(self) -> None:
        reads_dir = self.temp_dir / "renamed"
        reads_dir.mkdir(exist_ok=True)
        for mate in ("R1", "R2"):
            (reads_dir / f"renamed_{mate}.fastq").write_text(
                "@SRR1234567.1 1 length=4\nACGT\n+\nIIII\n", encoding="utf-8")
        run_dir = self.temp_dir / "runs" / "failed-isolate"
        write_run(run_dir, ["iso-a", "iso-b"], effective_cpus=4, extra_isolates=[{"id": "public-reads", "read_pairs": [
            {"r1": str(reads_dir / "renamed_R1.fastq"), "r2": str(reads_dir / "renamed_R2.fastq"), "trimmed": False},
        ]}])
        failed = run_snakemake(run_dir, self.conda_prefix, "--keep-going")
        self.assertNotEqual(failed.returncode, 0)
        self.assertTrue((run_dir / "results/isolates/iso-b/promotion-candidate.json").is_file())
        self.assertFalse((run_dir / "results/cohort/initial").exists())

        target = write_decision(run_dir, 2, ["iso-a", "iso-b"], ["public-reads"])
        dry_run = run_snakemake(run_dir, self.conda_prefix, "--dry-run", target)
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
        self.assertEqual(planned_rules(dry_run), COHORT_RULES)
        result = run_snakemake(run_dir, self.conda_prefix, target)
        self.assertEqual(result.returncode, 0, result.stderr)

        provenance = json.loads((run_dir / target).read_text(encoding="utf-8"))
        self.assertEqual(provenance["excluded_isolates"], {"public-reads": {"processing": "incomplete"}})
        self.assertFalse(provenance["initial_cohort"]["aggregated"])
        self.assertTrue((run_dir / "logs/isolates/public-reads/pairs/1/validate-read-pair.log").is_file())
        self.assertFalse((run_dir / "provenance" / "run.json").exists())

    def test_temporary_trimmed_reads_and_pair_alignments_are_removed(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        pair_dir = self.run_dir / "results" / "isolates" / "iso-b" / "pairs" / "2"
        self.assertTrue((pair_dir / "fastp.json").is_file())
        self.assertFalse((pair_dir / "trimmed_R1.fastq.gz").exists())
        self.assertFalse((pair_dir / "aligned.bam").exists())
        self.assertFalse((self.run_dir / "results" / "isolates" / "iso-b" / "markdup-work").exists())


if __name__ == "__main__":
    unittest.main()
