"""What every workflow script records the same way: timestamps, checksums, JSON, and pinned versions.

Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

CHECKSUM_ALGORITHM = "sha256"

# The rule environments several workflows use, such as the NCBI Datasets CLI's.
SHARED_ENVS_DIR = Path(__file__).resolve().parent.parent / "envs"

_PINNED_DEPENDENCY = re.compile(r"^\s*-\s+([A-Za-z0-9_.-]+)(?:==|=)([^\s=#]+)\s*(?:#.*)?$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_checksum(value: object) -> dict[str, str]:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"algorithm": CHECKSUM_ALGORITHM, "value": hashlib.sha256(encoded).hexdigest()}


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object in {path}")
    return value


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def configured_tool_versions(envs_dirs: list[Path]) -> dict[str, str]:
    """Read the exact pins from the rule environments in `envs_dirs`.

    The environment files are the single source of pinned versions, so a bump there is
    recorded without further edits. Conda (`name=version`) and pip (`name==version`)
    pins are both read. A package pinned to different versions in two environments, also
    in two of the directories, cannot be recorded as one configured version and is rejected.
    """
    versions: dict[str, str] = {}
    for envs_dir in envs_dirs:
        for environment in sorted(envs_dir.glob("*/environment.yaml")):
            for line in environment.read_text(encoding="utf-8").splitlines():
                match = _PINNED_DEPENDENCY.match(line)
                if not match:
                    continue
                name, version = match.groups()
                if versions.setdefault(name, version) != version:
                    raise ValueError(
                        f"{name} is pinned to both {versions[name]} and {version} "
                        f"across the rule environments in {', '.join(str(path) for path in envs_dirs)}"
                    )
    return versions
