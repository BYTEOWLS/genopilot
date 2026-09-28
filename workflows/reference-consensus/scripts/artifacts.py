"""Every file a reference-consensus run produces, in one list.

The Snakefile asks for the declared outputs below to schedule the run, and
the provenance steps checksum every entry, so the two cannot drift apart.
Paths are patterns inside the run directory: `{isolate}` is an isolate ID and
`{pair}` the 1-based position of a read pair in the isolate's snapshot entry.

`declared` is false for logs and benchmarks: Snakemake does not treat them
as outputs a rule can be asked for, so they are recorded when present but
never requested.

Standard library only; imported by the Snakefile and by the scripts.
"""

from __future__ import annotations

import hashlib
from pathlib import Path


def _artifact(artifact_id: str, path: str, artifact_type: str, stage: str, declared: bool = True) -> dict:
    return {"id": artifact_id, "path": path, "type": artifact_type, "stage": stage, "declared": declared}


def _log(artifact_id: str, stem: str, stage: str, benchmark: bool = True) -> list[dict]:
    entries = [_artifact(f"{artifact_id}-log", f"{stem}.log", "log", stage, declared=False)]
    if benchmark:
        entries.append(_artifact(f"{artifact_id}-benchmark", f"{stem}.benchmark.tsv", "tsv", stage, declared=False))
    return entries


RUN_ARTIFACTS = [
    _artifact("resolved-backbone", "resolved/backbone.fasta", "fasta", "resolve-inputs"),
    _artifact("resolved-backbone-provenance", "provenance/backbone.fasta.json", "json", "resolve-inputs"),
    _artifact("input-validation", "results/input-validation.json", "json", "validate-inputs"),
    *[
        _artifact(f"backbone-index-{suffix}", f"resolved/backbone.fasta.{suffix}", "index", "process-isolates")
        for suffix in ("amb", "ann", "bwt", "pac", "sa", "fai")
    ],
    *_log("resolve-backbone", "logs/resolve-backbone", "resolve-inputs", benchmark=False),
    *_log("validate-run-inputs", "logs/validate-run-inputs", "validate-inputs", benchmark=False),
    *_log("index-backbone", "logs/index-backbone", "process-isolates"),
]

_PAIR = "results/isolates/{isolate}/pairs/{pair}"
_PAIR_LOGS = "logs/isolates/{isolate}/pairs/{pair}"
PAIR_ARTIFACTS = [
    _artifact("read-validation", f"{_PAIR}/read-validation.json", "json", "process-isolates"),
    _artifact("read-group", f"{_PAIR}/read-group.txt", "text", "process-isolates"),
    _artifact("fastp-report", f"{_PAIR}/fastp.json", "json", "process-isolates"),
    _artifact("fastp-html-report", f"{_PAIR}/fastp.html", "html", "process-isolates"),
    *_log("validate-read-pair", f"{_PAIR_LOGS}/validate-read-pair", "process-isolates"),
    *_log("trim-read-pair", f"{_PAIR_LOGS}/trim-read-pair", "process-isolates"),
    *_log("align-read-pair", f"{_PAIR_LOGS}/align-read-pair", "process-isolates"),
]

_ISOLATE = "results/isolates/{isolate}"
_ISOLATE_LOGS = "logs/isolates/{isolate}"
ISOLATE_ARTIFACTS = [
    _artifact("alignment", f"{_ISOLATE}/alignment.bam", "bam", "process-isolates"),
    _artifact("alignment-index", f"{_ISOLATE}/alignment.bam.bai", "index", "process-isolates"),
    _artifact("duplicate-metrics", f"{_ISOLATE}/markdup.json", "json", "process-isolates"),
    _artifact("alignment-stats", f"{_ISOLATE}/samtools-stats.txt", "text", "process-isolates"),
    _artifact("alignment-flagstat", f"{_ISOLATE}/flagstat.json", "json", "process-isolates"),
    _artifact("coverage", f"{_ISOLATE}/coverage.tsv", "tsv", "process-isolates"),
    _artifact("all-sites-calls", f"{_ISOLATE}/all-sites.bcf", "bcf", "process-isolates"),
    _artifact("all-sites-calls-index", f"{_ISOLATE}/all-sites.bcf.csi", "index", "process-isolates"),
    _artifact("callable-mask", f"{_ISOLATE}/callable-mask.bed", "bed", "process-isolates"),
    _artifact("consensus-mask", f"{_ISOLATE}/consensus-mask.bed", "bed", "process-isolates"),
    _artifact("callability", f"{_ISOLATE}/callability.json", "json", "process-isolates"),
    _artifact("variants", f"{_ISOLATE}/variants.vcf.gz", "vcf", "process-isolates"),
    _artifact("variants-index", f"{_ISOLATE}/variants.vcf.gz.csi", "index", "process-isolates"),
    _artifact("consensus-fasta", f"{_ISOLATE}/consensus.fasta", "fasta", "process-isolates"),
    _artifact("consensus-fasta-index", f"{_ISOLATE}/consensus.fasta.fai", "index", "process-isolates"),
    _artifact("consensus-chain", f"{_ISOLATE}/consensus.chain", "chain", "process-isolates"),
    *_log("mark-duplicates", f"{_ISOLATE_LOGS}/mark-duplicates", "process-isolates"),
    *_log("alignment-metrics", f"{_ISOLATE_LOGS}/alignment-metrics", "process-isolates"),
    *_log("call-all-sites", f"{_ISOLATE_LOGS}/call-all-sites", "process-isolates"),
    *_log("classify-callability", f"{_ISOLATE_LOGS}/classify-callability", "process-isolates"),
    *_log("filter-normalize-variants", f"{_ISOLATE_LOGS}/filter-normalize-variants", "process-isolates"),
    *_log("build-isolate-consensus", f"{_ISOLATE_LOGS}/build-isolate-consensus", "process-isolates"),
]

# Written by summarize_isolate after every artifact above exists; it records the others.
ISOLATE_SUMMARY_ARTIFACTS = [
    _artifact("isolate-metrics", f"{_ISOLATE}/metrics.json", "json", "process-isolates"),
    _artifact("isolate-provenance", f"{_ISOLATE}/provenance.json", "json", "process-isolates"),
    _artifact("promotion-candidate", f"{_ISOLATE}/promotion-candidate.json", "json", "process-isolates"),
    _artifact("variant-stats", f"{_ISOLATE}/variant-stats.txt", "text", "process-isolates"),
    *_log("summarize-isolate", f"{_ISOLATE_LOGS}/summarize-isolate", "process-isolates"),
]


_COHORT = "results/cohort/initial"
COHORT_ARTIFACTS = [
    _artifact("support-sites", f"{_COHORT}/support-sites.tsv.gz", "tsv", "aggregate-support"),
    _artifact("support-sites-index", f"{_COHORT}/support-sites.tsv.gz.tbi", "index", "aggregate-support"),
    _artifact("support-intervals", f"{_COHORT}/support-intervals.tsv.gz", "tsv", "aggregate-support"),
    _artifact("support-intervals-index", f"{_COHORT}/support-intervals.tsv.gz.tbi", "index", "aggregate-support"),
    _artifact("support-summary", f"{_COHORT}/support-summary.json", "json", "aggregate-support"),
    *_log("aggregate-support", "logs/cohort/initial/aggregate-support", "aggregate-support"),
    _artifact("cohort-consensus-fasta", f"{_COHORT}/consensus.fasta", "fasta", "generate-consensus"),
    _artifact("cohort-consensus-fasta-index", f"{_COHORT}/consensus.fasta.fai", "index", "generate-consensus"),
    _artifact("consensus-sites", f"{_COHORT}/consensus-sites.tsv.gz", "tsv", "generate-consensus"),
    _artifact("consensus-sites-index", f"{_COHORT}/consensus-sites.tsv.gz.tbi", "index", "generate-consensus"),
    _artifact("consensus-summary", f"{_COHORT}/consensus-summary.json", "json", "generate-consensus"),
    *_log("generate-consensus", "logs/cohort/initial/generate-consensus", "generate-consensus"),
]


def _expand(entry: dict, **wildcards) -> dict:
    return {**entry, "path": entry["path"].format(**wildcards), **wildcards}


def isolate_artifacts(isolate: dict, include_summary: bool = True) -> list[dict]:
    """One isolate's artifacts, its read pairs' first, from its snapshot entry."""
    pairs = range(1, len(isolate["read_pairs"]) + 1)
    entries = [_expand(entry, isolate=isolate["id"], pair=pair) for pair in pairs for entry in PAIR_ARTIFACTS]
    entries += [_expand(entry, isolate=isolate["id"]) for entry in ISOLATE_ARTIFACTS]
    if include_summary:
        entries += [_expand(entry, isolate=isolate["id"]) for entry in ISOLATE_SUMMARY_ARTIFACTS]
    return entries


def run_artifacts(isolates: list[dict]) -> list[dict]:
    """Every artifact of a run over the snapshot's isolates, in snapshot order, then the cohort's."""
    return (
        [dict(entry) for entry in RUN_ARTIFACTS]
        + [entry for isolate in isolates for entry in isolate_artifacts(isolate)]
        + [dict(entry) for entry in COHORT_ARTIFACTS]
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checksum_artifact(entry: dict, origin: str = "generated") -> dict:
    """The artifact's record with its SHA-256 and size, or its absence when it does not exist."""
    path = Path(entry["path"])
    record = {key: entry[key] for key in ("id", "path", "type", "stage") if key in entry}
    record.update({key: entry[key] for key in ("isolate", "pair") if key in entry})
    record["origin"] = origin
    if not path.is_file():
        record["status"] = "missing"
        return record
    record["checksum"] = {"algorithm": "sha256", "value": sha256_file(path)}
    record["size_bytes"] = path.stat().st_size
    return record
