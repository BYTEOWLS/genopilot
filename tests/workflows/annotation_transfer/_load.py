"""Loads an annotation-transfer workflow script by path as an importable module.

The workflow's own scripts live under `workflows/annotation-transfer/scripts/`,
next to its Snakefile; see `shared/_load.py` for why they are loaded by path.
"""

from __future__ import annotations

from types import ModuleType

from ..shared import _load as shared

WORKFLOW_DIR = shared.PROJECT_ROOT / "workflows" / "annotation-transfer"
SCRIPTS_DIR = WORKFLOW_DIR / "scripts"
FIXTURES_DIR = shared.PROJECT_ROOT / "tests" / "fixtures" / "annotation-transfer"


def load_script(name: str) -> ModuleType:
    return shared.load_script(name, SCRIPTS_DIR)
