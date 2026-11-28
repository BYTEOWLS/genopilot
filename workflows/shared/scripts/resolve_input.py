#!/usr/bin/env python3
"""Copy local inputs or resolve provider references through the packaged Node bridge."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from genome_source import copy_genome  # noqa: E402
from provenance import CHECKSUM_ALGORITHM, sha256_file, utc_now_iso, write_json  # noqa: E402

SCHEMA_VERSION = 2


def resolve_local(source: Path, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return sha256_file(destination)


def build_local_provenance(source: Path, checksum: str) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "local",
        "path": str(source),
        "checksum": {"algorithm": CHECKSUM_ALGORITHM, "value": checksum},
        "resolved_at": utc_now_iso(),
        "origin": "imported",
    }


def build_remote_provenance(input_source: dict, genome: dict, kind: str) -> dict:
    reference = genome["reference"]
    return {
        "schema_version": SCHEMA_VERSION,
        **reference,
        "cache_mode": input_source["cache_mode"],
        "cache_path": str(Path(genome[kind]).parent),
        "provider_facts": genome["facts"],
        "resolver": genome["resolver"],
        "metadata": genome["metadata"],
        "annotation": genome["annotation"],
        "downloaded": genome["downloaded"],
        "checksum": {"algorithm": CHECKSUM_ALGORITHM, "value": genome[f"{kind}_sha256"]},
        "resolved_at": utc_now_iso(),
        "origin": "imported",
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", choices=["reference", "target", "backbone"], required=True)
    parser.add_argument("--input-json", type=json.loads, required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--fasta-destination", type=Path, required=True)
    parser.add_argument("--fasta-provenance", type=Path, required=True)
    parser.add_argument("--gff3-destination", type=Path)
    parser.add_argument("--gff3-provenance", type=Path)
    args = parser.parse_args(argv)
    if args.role == "reference" and (not args.gff3_destination or not args.gff3_provenance):
        parser.error("--gff3-destination and --gff3-provenance are required for --role reference")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    source = args.input_json
    destinations = {"fasta": args.fasta_destination}
    provenance = {"fasta": args.fasta_provenance}
    if args.role == "reference":
        destinations["gff3"] = args.gff3_destination
        provenance["gff3"] = args.gff3_provenance
    if source["source"] == "local":
        for kind, destination in destinations.items():
            path = Path(source[kind])
            checksum = resolve_local(path, destination)
            write_json(provenance[kind], build_local_provenance(path, checksum))
        return 0

    request = {
        "reference": source["reference"],
        "kinds": list(destinations),
        "root": args.output_root,
        "mode": source["cache_mode"],
        **({"copy": source["copy"]} if "copy" in source else {}),
    }
    # Node holds the source lease until Python has verified and published every copy.
    genome = copy_genome(request, destinations)
    for kind in destinations:
        write_json(provenance[kind], build_remote_provenance(source, genome, kind))
    return 0


if __name__ == "__main__":
    sys.exit(main())
