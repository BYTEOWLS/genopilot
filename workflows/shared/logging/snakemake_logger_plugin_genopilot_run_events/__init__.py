"""Snakemake logger plugin that records structured run events as JSON Lines.

Snakemake 9 discovers logger plugins by scanning `sys.path` for packages named
`snakemake_logger_plugin_*`, so this package is made available by putting its
parent directory on `PYTHONPATH` rather than by installing it. That parent
directory holds nothing else, so it cannot shadow any real module in the
Conda environments Snakemake provisions for individual rules.

Enable it with:

    snakemake --logger genopilot-run-events --logger-genopilot-run-events-path events.jsonl

The path defaults to `events.jsonl` in the working directory, which is the run
directory when Snakemake is invoked with `--directory <run-dir>`. Running a
workflow directly, without the TUI, produces the same file.

`events.py` holds the record translation and imports nothing from Snakemake;
everything here is the plumbing that the pinned
`snakemake-interface-logger-plugins` 2.x contract requires.
"""

import json
import logging
from dataclasses import dataclass, field
from logging import LogRecord
from typing import Optional

from snakemake_interface_logger_plugins.base import LogHandlerBase
from snakemake_interface_logger_plugins.settings import LogHandlerSettingsBase

from .events import translate

DEFAULT_EVENTS_FILENAME = "events.jsonl"


# No `from __future__ import annotations` in this module: Snakemake derives each plugin
# setting's argparse type from this dataclass's annotation object, and a stringized
# annotation is rejected as "not callable".
@dataclass
class LogHandlerSettings(LogHandlerSettingsBase):
    path: Optional[str] = field(
        default=None,
        metadata={
            "help": "Where to append JSON Lines run events.",
            "env_var": False,
            "required": False,
        },
    )


class LogHandler(LogHandlerBase, logging.FileHandler):
    """Appends one JSON object per structured Snakemake event.

    Subclasses `logging.FileHandler` because Snakemake reads `baseFilename` from every
    handler that declares `writes_to_file`, and reports it among the run's log files.
    """

    def __init__(self, common_settings, settings) -> None:
        path = getattr(settings, "path", None) or DEFAULT_EVENTS_FILENAME
        # Appending keeps every attempt in one place: a resumed or repeated run adds its
        # events after the earlier ones, each attempt opening with its own workflow-started.
        logging.FileHandler.__init__(self, path, mode="a", encoding="utf-8")
        LogHandlerBase.__init__(self, common_settings, settings)

    @property
    def writes_to_stream(self) -> bool:
        return False

    @property
    def writes_to_file(self) -> bool:
        return True

    @property
    def has_filter(self) -> bool:
        # Snakemake's default filter drops records this contract needs; `translate` decides
        # what is recorded instead.
        return True

    @property
    def has_formatter(self) -> bool:
        return True

    @property
    def needs_rulegraph(self) -> bool:
        return False

    def emit(self, record: LogRecord) -> None:
        try:
            fields = dict(record.__dict__)
            fields["message"] = record.getMessage()
            event = translate(fields)
            if event is None:
                return
            self.stream.write(json.dumps(event, ensure_ascii=False) + "\n")
            self.flush()
        except Exception:  # noqa: BLE001 - logging must never abort the workflow
            self.handleError(record)
