#!/usr/bin/env python3
"""Resolve a reference, target, or backbone input into a canonical, checksummed file.

Normalizes a `local` (already-existing path) or `ncbi` (versioned assembly
accession) source into the same kind of output before any scientific rule
runs, and records a provenance JSON document for each resolved file. Kept
dependency-free (standard library only) so it runs directly with the
interpreter Snakemake already uses, without its own conda environment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

SCHEMA_VERSION = 1
CHECKSUM_ALGORITHM = "sha256"
_FILE_KIND_SUFFIXES = {"fasta": ".fna", "gff3": ".gff"}

DownloadFn = Callable[[str, list[str], Path, str, str | None], None]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json_or_empty(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def resolve_local(source: Path, destination: Path) -> str:
    """Copies a local source into place and returns its checksum."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return sha256_file(destination)


def should_download(cache_mode: str, cache_file_exists: bool, checksum_matches: bool) -> bool:
    """Pure caching decision, kept separate from I/O so it is directly testable.

    A missing cache entry always downloads. `refresh` always re-downloads.
    `reuse` trusts an existing entry unless its checksum no longer matches
    the value recorded when it was last fetched (data-integrity fallback,
    not a preference).
    """
    if not cache_file_exists:
        return True
    if cache_mode == "refresh":
        return True
    return not checksum_matches


def get_datasets_version(datasets_bin: str) -> str:
    result = subprocess.run(
        [datasets_bin, "version"], check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def download_accession(
    accession: str,
    include: list[str],
    destination_dir: Path,
    datasets_bin: str,
    api_key_env: str | None,
) -> None:
    """Fetches an accession via the `datasets` CLI and unpacks it in place.

    Reads the optional API key from the process environment directly rather
    than a shell-expanded string, so its value never passes through a
    logged or displayed command.
    """
    destination_dir.mkdir(parents=True, exist_ok=True)
    archive_path = destination_dir / "ncbi_dataset.zip"
    command = [
        datasets_bin,
        "download",
        "genome",
        "accession",
        accession,
        "--include",
        ",".join(include),
        "--filename",
        str(archive_path),
    ]
    api_key = os.environ.get(api_key_env) if api_key_env else None
    if api_key:
        command += ["--api-key", api_key]
    subprocess.run(command, check=True)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(destination_dir)
    archive_path.unlink(missing_ok=True)


def find_downloaded_file(accession_dir: Path, accession: str, suffix: str) -> Path:
    data_dir = accession_dir / "ncbi_dataset" / "data" / accession
    matches = sorted(data_dir.glob(f"*{suffix}"))
    if not matches:
        raise FileNotFoundError(f"no *{suffix} file found for {accession} under {data_dir}")
    return matches[0]


def resolve_ncbi_bundle(
    accession: str,
    file_kinds: list[str],
    cache_dir: Path,
    cache_mode: str,
    datasets_bin: str,
    api_key_env: str | None,
    download: DownloadFn = download_accession,
) -> tuple[dict[str, str], bool]:
    """Resolves one or more files sharing a single accession download.

    Returns the checksum for each requested `file_kind` and whether a
    download actually ran. Reference fasta+gff3 share one call so two
    Snakemake outputs never race a first-time download of the same
    accession cache entry.
    """
    accession_cache_dir = cache_dir / accession
    checksums_path = accession_cache_dir / "checksums.json"
    cached_files = {
        kind: accession_cache_dir / f"genomic{_FILE_KIND_SUFFIXES[kind]}" for kind in file_kinds
    }
    recorded = read_json_or_empty(checksums_path)

    needs_download = False
    for kind, path in cached_files.items():
        exists = path.is_file()
        matches = exists and sha256_file(path) == recorded.get(kind)
        if should_download(cache_mode, exists, matches):
            needs_download = True

    downloaded = False
    if needs_download:
        include = sorted({"genome" if kind == "fasta" else kind for kind in file_kinds})
        download(accession, include, accession_cache_dir, datasets_bin, api_key_env)
        for kind, path in cached_files.items():
            source_file = find_downloaded_file(
                accession_cache_dir, accession, _FILE_KIND_SUFFIXES[kind]
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_file, path)
        downloaded = True

    checksums = dict(recorded)
    for kind, path in cached_files.items():
        checksums[kind] = sha256_file(path)
    write_json(checksums_path, checksums)
    return checksums, downloaded


def build_local_provenance(source: Path, checksum: str) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "local",
        "path": str(source),
        "checksum": {"algorithm": CHECKSUM_ALGORITHM, "value": checksum},
        "resolved_at": utc_now_iso(),
        "origin": "imported",
    }


def build_ncbi_provenance(
    accession: str,
    cache_mode: str,
    checksum: str,
    datasets_version: str,
    downloaded: bool,
) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "ncbi",
        "accession": accession,
        "cache_mode": cache_mode,
        "datasets_cli_version": datasets_version,
        "downloaded": downloaded,
        "checksum": {"algorithm": CHECKSUM_ALGORITHM, "value": checksum},
        "resolved_at": utc_now_iso(),
        "origin": "imported",
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", choices=["reference", "target", "backbone"], required=True)
    parser.add_argument("--source-type", choices=["local", "ncbi"], required=True)
    parser.add_argument("--fasta-destination", type=Path, required=True)
    parser.add_argument("--fasta-provenance", type=Path, required=True)
    parser.add_argument("--gff3-destination", type=Path)
    parser.add_argument("--gff3-provenance", type=Path)
    parser.add_argument("--local-fasta", type=Path)
    parser.add_argument("--local-gff3", type=Path)
    parser.add_argument("--accession")
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--cache-mode", choices=["reuse", "refresh"], default="reuse")
    parser.add_argument("--datasets-bin", default="datasets")
    parser.add_argument("--api-key-env", default="NCBI_API_KEY")
    args = parser.parse_args(argv)

    if args.role == "reference" and (not args.gff3_destination or not args.gff3_provenance):
        parser.error("--gff3-destination and --gff3-provenance are required for --role reference")
    if args.source_type == "local":
        if not args.local_fasta:
            parser.error("--local-fasta is required for --source-type local")
        if args.role == "reference" and not args.local_gff3:
            parser.error("--local-gff3 is required for --source-type local --role reference")
    if args.source_type == "ncbi":
        if not args.accession:
            parser.error("--accession is required for --source-type ncbi")
        if not args.cache_dir:
            parser.error("--cache-dir is required for --source-type ncbi")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    if args.source_type == "local":
        fasta_checksum = resolve_local(args.local_fasta, args.fasta_destination)
        write_json(
            args.fasta_provenance, build_local_provenance(args.local_fasta, fasta_checksum)
        )
        if args.role == "reference":
            gff3_checksum = resolve_local(args.local_gff3, args.gff3_destination)
            write_json(
                args.gff3_provenance, build_local_provenance(args.local_gff3, gff3_checksum)
            )
        return 0

    file_kinds = ["fasta", "gff3"] if args.role == "reference" else ["fasta"]
    checksums, downloaded = resolve_ncbi_bundle(
        args.accession,
        file_kinds,
        args.cache_dir,
        args.cache_mode,
        args.datasets_bin,
        args.api_key_env,
        download=download_accession,
    )
    datasets_version = get_datasets_version(args.datasets_bin)

    accession_cache_dir = args.cache_dir / args.accession
    fasta_cached = accession_cache_dir / f"genomic{_FILE_KIND_SUFFIXES['fasta']}"
    args.fasta_destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(fasta_cached, args.fasta_destination)
    write_json(
        args.fasta_provenance,
        build_ncbi_provenance(
            args.accession, args.cache_mode, checksums["fasta"], datasets_version, downloaded
        ),
    )
    if args.role == "reference":
        gff3_cached = accession_cache_dir / f"genomic{_FILE_KIND_SUFFIXES['gff3']}"
        args.gff3_destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(gff3_cached, args.gff3_destination)
        write_json(
            args.gff3_provenance,
            build_ncbi_provenance(
                args.accession, args.cache_mode, checksums["gff3"], datasets_version, downloaded
            ),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
