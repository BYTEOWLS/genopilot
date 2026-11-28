"""Copy provider files while the packaged Node resolver holds their cache lease."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from provenance import sha256_file


def copy_genome(request: dict, destinations: dict[str, Path]) -> dict:
    """Acknowledge consumption only after every staged copy matches its digest.

    Node keeps refresh and deletion excluded through the final run-file replacement.
    Closing stdin without acknowledgment is a failed consumer, never successful reuse.
    """
    entry = Path(__file__).resolve().parents[3] / "dist" / "genome-source.js"
    node = os.environ.get("GENOPILOT_NODE_EXECUTABLE") or shutil.which("node")
    if not node:
        raise RuntimeError(
            "Node is required to resolve genome sources. Put node on PATH or set "
            "GENOPILOT_NODE_EXECUTABLE to its absolute executable path."
        )
    process = subprocess.Popen(
        [node, str(entry)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    staged: dict[str, Path] = {}
    try:
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        line = process.stdout.readline()
        if not line:
            raise RuntimeError(process.stderr.read().strip() or "Genome resolver returned no files.")
        genome = json.loads(line)
        for kind, destination in destinations.items():
            source = genome.get(kind)
            checksum = genome.get(f"{kind}_sha256")
            if not source or not checksum:
                raise RuntimeError(f"This input role requires {kind}, which is unavailable.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".genome-", dir=destination.parent)
            os.close(descriptor)
            staged[kind] = Path(temporary)
            shutil.copyfile(source, temporary)
            if sha256_file(staged[kind]) != checksum:
                raise RuntimeError(f"Copied {kind} no longer matches its verified checksum.")
        for kind, temporary in staged.items():
            os.replace(temporary, destinations[kind])
        process.stdin.write('{"copied":true}\n')
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError(process.stderr.read().strip() or "Genome resolver failed.")
        return genome
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)
        try:
            if not process.stdin.closed:
                process.stdin.close()
        except BrokenPipeError:
            pass
        finally:
            # EOF lets Node release its lock after Python fails part-way through copying.
            process.wait()
            process.stdout.close()
            process.stderr.close()
