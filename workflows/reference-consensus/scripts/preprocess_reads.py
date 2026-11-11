#!/usr/bin/env python3
"""Run the snapshotted Illumina fastp settings, or explicitly skip provider-trimmed inputs."""
import argparse
import json
import shlex
import subprocess
from pathlib import Path


def fastp_options(settings: dict) -> list[str]:
    return ["--detect_adapter_for_pe", "--disable_quality_filtering", "--length_required", str(settings["minimum_length"]),
            *(["--trim_poly_g", "--poly_g_min_len", str(settings["poly_g_min_length"])]
              if settings["poly_g"] else ["--disable_trim_poly_g"])]


def preprocess(pair: dict, directory: Path, threads: int) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    if pair["trimmed"]:
        for mate in ("r1", "r2"):
            output = directory / f"trimmed_{mate.upper()}.fastq.gz"
            output.unlink(missing_ok=True)
            output.symlink_to(Path(pair[mate]).resolve())
        report = {"status": "skipped-provider-trimmed", "origin": "imported", "settings": pair["preprocessing"],
                  "summary": {"before_filtering": None, "after_filtering": None}}
        (directory / "fastp.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        (directory / "fastp.html").write_text(
            "<html><body><p>fastp skipped: provider-trimmed input. No GenoPilot trimming was performed.</p></body></html>\n",
            encoding="utf-8")
        print("fastp skipped: provider-trimmed inputs linked unchanged", flush=True)
        return
    command = ["fastp", "--in1", pair["r1"], "--in2", pair["r2"],
               "--out1", str(directory / "trimmed_R1.fastq.gz"), "--out2", str(directory / "trimmed_R2.fastq.gz"),
               "--json", str(directory / "fastp.json"), "--html", str(directory / "fastp.html"),
               *fastp_options(pair["preprocessing"]), "--thread", str(threads)]
    print(shlex.join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-json", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--threads", type=int, required=True)
    args = parser.parse_args()
    preprocess(json.loads(args.pair_json), args.directory, args.threads)


if __name__ == "__main__":
    main()
