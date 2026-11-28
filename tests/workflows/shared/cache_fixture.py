"""A verified provider cache built only from the repository's synthetic fixtures."""

import hashlib
import json
from pathlib import Path


def cached_genome(
    root: Path, fasta: Path, gff3: Path | None = None, *, identifier: str = "GCF_000000001.1",
) -> dict:
    reference = {"source": "ncbi", "id": identifier, "parameters": {}}
    cache = root / "ncbi-accessions-cache" / reference["id"]
    cache.mkdir(parents=True)
    checksums = {}
    for kind, source, filename in [("fasta", fasta, "genomic.fna"), ("gff3", gff3, "genomic.gff")]:
        if source:
            content = source.read_bytes()
            (cache / filename).write_bytes(content)
            checksums[kind] = hashlib.sha256(content).hexdigest()
    (cache / "checksums.json").write_text(json.dumps(checksums))
    (cache / "genome.json").write_text(json.dumps({
        "reference": reference, "metadata": None, "facts": {"fixture": "synthetic"},
        "annotation": "available" if gff3 else "not-requested",
    }))
    return {"source": "remote", "reference": reference, "cache_mode": "reuse", "copy": {
        "path": str(cache), **{f"{kind}_sha256": digest for kind, digest in checksums.items()},
    }}
