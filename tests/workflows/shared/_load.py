"""Loads a workflow script by path as an importable module.

The scripts under `workflows/<id>/scripts/` and `workflows/shared/scripts/` are
plain, dependency-free files invoked directly by Snakemake rules, not a Python
package, so tests load them by file path instead of adding packaging machinery
they do not otherwise need.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = PROJECT_ROOT / "workflows" / "shared" / "scripts"
LOGGING_DIR = PROJECT_ROOT / "workflows" / "shared" / "logging"


def load_script(name: str, scripts_dir: Path = SCRIPTS_DIR) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, scripts_dir / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_run_events_module() -> ModuleType:
    """Loads the logger plugin's Snakemake-free record translation.

    Only `events.py` is loaded, by path: importing the package itself would pull in
    `snakemake_interface_logger_plugins`, which these tests deliberately do not require.
    """
    path = LOGGING_DIR / "snakemake_logger_plugin_genopilot_run_events" / "events.py"
    spec = importlib.util.spec_from_file_location("genopilot_run_events_events", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
