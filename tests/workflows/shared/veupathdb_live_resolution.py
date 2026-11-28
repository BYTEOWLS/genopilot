"""Offline direct-workflow consumer checks for the opt-in live provider test."""

import json
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT))
from tests.workflows.annotation_transfer.test_snakefile_direct_execution import write_local_config
from tests.workflows.reference_consensus.fixtures import EXPECTED, write_run


def main():
    request = json.load(sys.stdin)
    summaries = []
    for role in ("reference", "target", "backbone"):
        run = Path(request["root"]) / "direct" / role
        run.mkdir(parents=True)
        kinds = ("fasta", "gff3") if role == "reference" else ("fasta",)
        copy = {"path": request["copy"]["path"], **{
            f"{kind}_sha256": request["copy"][f"{kind}_sha256"] for kind in kinds
        }}
        remote = {"source": "remote", "reference": request["reference"], "cache_mode": "reuse", "copy": copy}
        workflow = "reference-consensus" if role == "backbone" else "annotation-transfer"
        if role == "backbone":
            config = write_run(run, [next(iter(EXPECTED["isolates"]))])
            configuration = json.loads(config.read_text())
            configuration["inputs"][role] = remote
            config.write_text(json.dumps(configuration))
        else:
            config = write_local_config(run)
            text = config.read_text()
            start = text.index(f"  {role}:\n")
            end = text.index("  target:\n", start) if role == "reference" else text.index("lifton:\n")
            config.write_text(text[:start] + f"  {role}: " + json.dumps(remote) + "\n" + text[end:])
        command = [request["snakemake"], "--snakefile", str(PROJECT_ROOT / "workflows" / workflow / "Snakefile"),
                   "--directory", str(run), "--configfile", str(config), "--cores", "1",
                   *[f"resolved/{role}.{kind}" for kind in kinds]]
        result = subprocess.run(command, cwd=request["root"], env=os.environ, capture_output=True, text=True)
        if result.returncode:
            logs = "\n".join(path.read_text() for path in (run / "logs").glob("resolve-*.log"))
            raise RuntimeError(result.stdout + result.stderr + logs)
        for kind in kinds:
            provenance = json.loads((run / f"provenance/{role}.{kind}.json").read_text())
            assert provenance["downloaded"] is False
            assert provenance["origin"] == "imported"
            assert provenance["source"] == "veupathdb"
            assert provenance["id"] == request["reference"]["id"]
            assert provenance["checksum"]["value"] == copy[f"{kind}_sha256"]
        summaries.append(role)
    print(json.dumps(summaries))


if __name__ == "__main__":
    main()
