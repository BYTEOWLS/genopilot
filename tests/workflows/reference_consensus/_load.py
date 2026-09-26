"""Loads a reference-consensus workflow script by path as an importable module.

The workflow's own scripts live under `workflows/reference-consensus/scripts/`,
next to its Snakefile; see `annotation_transfer/_load.py` for why they are
loaded by path.
"""

from __future__ import annotations

import importlib.util
import sys
from types import ModuleType

from ..annotation_transfer._load import PROJECT_ROOT

WORKFLOW_DIR = PROJECT_ROOT / "workflows" / "reference-consensus"
SCRIPTS_DIR = WORKFLOW_DIR / "scripts"


def load_script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
