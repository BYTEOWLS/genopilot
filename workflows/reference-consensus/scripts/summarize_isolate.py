#!/usr/bin/env python3
"""Summarize one processed isolate and describe its genome as a promotion candidate.

Runs after the isolate's consensus FASTA has been built and checked, and
collects what the tools already reported; nothing is recounted here:

  fastp.json          read counts and lengths before and after trimming, per read pair
  read-validation     read group, sequencing run fields, and file checksums, per read pair
  markdup.json        duplicates per library (samtools markdup)
  flagstat.json       mapped and properly paired reads (samtools flagstat)
  coverage.tsv        per-contig depth and breadth (samtools coverage)
  callability.json    callable, ambiguous, and uncallable bases
  variant stats       PASS SNPs and indels (`bcftools stats`)

Writes:
  --metrics     the isolate's metrics (JSON)
  --provenance  its read pairs, effective calling parameters, observed tool
                versions, and the checksum of every artifact it produced
  --candidate   a versioned promotion candidate: the consensus FASTA and index
                with checksums, the isolate, the backbone, the producing run,
                and the workflow. It names everything needed to copy the genome
                into the isolate catalog later and verify the copy, without
                reading the catalog. The step runs only after the consensus
                FASTA passed its checks in build_isolate_consensus.

Standard library only; `fastp`, `bwa`, `samtools`, and `bcftools` must be on
PATH to report their versions.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from artifacts import checksum_artifact, isolate_artifacts, sha256_file  # noqa: E402

SCHEMA_VERSION = 1
CANDIDATE_SCHEMA_VERSION = 1


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def tool_versions() -> dict:
    """The versions the tools on PATH report about themselves."""
    commands = {
        "fastp": ["fastp", "--version"],
        "bwa": ["bwa"],
        "samtools": ["samtools", "--version"],
        "bcftools": ["bcftools", "--version"],
    }
    versions = {}
    for name, command in commands.items():
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False)
        except FileNotFoundError:
            versions[name] = {"status": "unavailable", "reason": "not on PATH"}
            continue
        text = result.stdout + result.stderr
        match = re.search(r"Version: (\S+)", text) if name == "bwa" else re.search(rf"{name} (\S+)", text)
        versions[name] = (
            {"version": match.group(1), "source": "executable"}
            if match
            else {"status": "unavailable", "reason": "version not reported"}
        )
    return versions


def variant_counts(stats_path: Path) -> dict:
    """PASS SNP and indel counts from the `SN` section of `bcftools stats`."""
    counts = {}
    names = {"number of SNPs:": "snps", "number of indels:": "indels", "number of MNPs:": "mnps"}
    for line in stats_path.read_text(encoding="utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) == 4 and fields[0] == "SN" and fields[2] in names:
            counts[names[fields[2]]] = int(fields[3])
    return counts


def coverage_summary(coverage_path: Path) -> dict:
    """Length-weighted mean depth and breadth from `samtools coverage`."""
    contigs = []
    for line in coverage_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line:
            continue
        name, start, end, reads, covered, _, depth = line.split("\t")[:7]
        contigs.append({
            "contig": name,
            "length": int(end) - int(start) + 1,
            "reads": int(reads),
            "covered_bases": int(covered),
            "mean_depth": float(depth),
        })
    length = sum(contig["length"] for contig in contigs)
    return {
        "mean_depth": round(sum(c["mean_depth"] * c["length"] for c in contigs) / length, 3) if length else 0.0,
        "covered_fraction": round(sum(c["covered_bases"] for c in contigs) / length, 6) if length else 0.0,
        "contigs": contigs,
    }


def trimmed_status(pairs: list[dict]) -> str:
    flags = {pair["trimmed"] for pair in pairs}
    return "partly-trimmed" if len(flags) > 1 else ("trimmed" if flags == {True} else "untrimmed")


def build_metrics(isolate_id: str, directory: Path, pair_count: int, calling: dict) -> dict:
    pairs = []
    for number in range(1, pair_count + 1):
        validation = read_json(directory / "pairs" / str(number) / "read-validation.json")
        fastp = read_json(directory / "pairs" / str(number) / "fastp.json")["summary"]
        pairs.append({
            "pair": number,
            "trimmed": validation["trimmed"],
            "read_group": validation["read_group"]["id"],
            "library": validation["read_group"]["lb"],
            "before_trimming": fastp["before_filtering"],
            "after_trimming": fastp["after_filtering"],
        })
    flagstat = read_json(directory / "flagstat.json")["QC-passed reads"]
    markdup = read_json(directory / "markdup.json")
    callability = read_json(directory / "callability.json")
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "isolate_id": isolate_id,
        "trimmed": trimmed_status(pairs),
        "calling": calling,
        "read_pairs": pairs,
        "alignment": {
            "reads": flagstat["total"],
            "primary_mapped": flagstat["primary mapped"],
            "primary_mapped_percent": flagstat["primary mapped %"],
            "properly_paired_percent": flagstat["properly paired %"],
            "duplicates": flagstat["duplicates"],
        },
        "duplicates_per_library": {
            library["library"]: library["markdup"] for library in markdup["libraries"]
        },
        "coverage": coverage_summary(directory / "coverage.tsv"),
        "callability": {key: callability[key] for key in ("bases", "genome_length", "callable_fraction")},
        "variants": variant_counts(directory / "variant-stats.txt"),
    }


def build_candidate(isolate_id: str, config: dict, run_dir: Path) -> dict:
    directory = f"results/isolates/{isolate_id}"
    backbone = config["inputs"]["backbone"]
    return {
        "schema_version": CANDIDATE_SCHEMA_VERSION,
        "isolate_id": isolate_id,
        "fasta": {
            "path": f"{directory}/consensus.fasta",
            "sha256": sha256_file(run_dir / directory / "consensus.fasta"),
        },
        "fasta_index": {
            "path": f"{directory}/consensus.fasta.fai",
            "sha256": sha256_file(run_dir / directory / "consensus.fasta.fai"),
        },
        "backbone": {
            "source": backbone["source"],
            **({"accession": backbone["accession"]} if backbone["source"] == "ncbi" else {}),
            **({"file_name": Path(backbone["fasta"]).name} if backbone["source"] == "local" else {}),
            "sha256": sha256_file(run_dir / "resolved" / "backbone.fasta"),
        },
        "producing_run": {"id": config["run"]["id"], "created_at": config["run"]["created_at"]},
        "workflow": {"id": config["workflow_id"], "version": config["workflow_version"]},
        "provenance": f"{directory}/provenance.json",
        "created_at": utc_now_iso(),
    }


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config-json", required=True, help="the run's effective configuration")
    parser.add_argument("--isolate-json", required=True, help="the isolate's snapshot entry")
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    run_dir = Path.cwd()
    config = json.loads(args.config_json)
    isolate = json.loads(args.isolate_json)
    isolate_id = isolate["id"]
    directory = Path("results/isolates") / isolate_id
    calling = config["calling"]

    write_json(args.metrics, build_metrics(isolate_id, directory, len(isolate["read_pairs"]), calling))

    pairs = []
    for number in range(1, len(isolate["read_pairs"]) + 1):
        validation = read_json(directory / "pairs" / str(number) / "read-validation.json")
        fastp = read_json(directory / "pairs" / str(number) / "fastp.json")["summary"]["before_filtering"]
        pairs.append({
            "pair": number,
            "files": validation["files"],
            "origin": "imported",
            "trimmed": validation["trimmed"],
            "sequencing": validation["sequencing"],
            "read_group": validation["read_group"],
            "reads": fastp["total_reads"],
            "read1_mean_length": fastp["read1_mean_length"],
            "read2_mean_length": fastp["read2_mean_length"],
        })
    own_outputs = {str(args.metrics), str(args.provenance), str(args.candidate)}
    artifacts = [
        checksum_artifact(entry)
        for entry in isolate_artifacts(isolate)
        if entry["path"] not in own_outputs and not entry["id"].startswith("summarize-isolate")
    ]
    write_json(args.provenance, {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now_iso(),
        "isolate_id": isolate_id,
        "workflow": {"id": config["workflow_id"], "version": config["workflow_version"]},
        "run": {"id": config["run"]["id"], "created_at": config["run"]["created_at"]},
        "calling": calling,
        "read_pairs": pairs,
        "tool_versions": tool_versions(),
        "artifacts": artifacts,
    })

    write_json(args.candidate, build_candidate(isolate_id, config, run_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
