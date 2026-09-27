"""Translation from Snakemake log records to this project's run-event contract.

Kept free of Snakemake imports so its tests run without a provisioned
environment, exactly like the rule scripts under `../scripts/`.

The contract is a JSON Lines file: one self-describing object per line,
written as the run progresses. It reports what a run is doing — which jobs
are pending, running, completed, or failed — and deliberately not the
console text Snakemake prints, which is preserved separately and in full as
the run's stdout/stderr logs.

Consumers must ignore unknown `type` values and unknown fields, and must
treat a line whose `schema_version` they do not know as incompatible rather
than guessing at its meaning.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, Iterable, Mapping, Optional

SCHEMA_VERSION = 1

# Snakemake's own LogEvent values, mapped to the event types of this contract. Every other
# Snakemake event is dropped: this file is a progress contract, not a second copy of the log.
_EVENT_TYPES = {
    "workflow_started": "workflow-started",
    "run_info": "run-info",
    "job_info": "job-started",
    "job_finished": "job-finished",
    "job_error": "job-failed",
    "progress": "progress",
    "error": "error",
}


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _paths(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, (str, bytes)):
        return [str(value)]
    if isinstance(value, Iterable):
        return [str(item) for item in value]
    return [str(value)]


def _integer(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _counts(value: Any) -> Dict[str, int]:
    if not isinstance(value, Mapping):
        return {}
    counts = {}
    for name, count in value.items():
        parsed = _integer(count)
        if parsed is not None:
            counts[str(name)] = parsed
    return counts


def _wildcards(value: Any) -> Dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    return {str(name): str(item) for name, item in value.items()}


def format_timestamp(created: Any) -> str:
    """Formats a `logging.LogRecord.created` epoch value as an ISO 8601 UTC instant."""
    seconds = created if isinstance(created, (int, float)) else 0.0
    moment = datetime.datetime.fromtimestamp(seconds, tz=datetime.timezone.utc)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def translate(fields: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """Builds one run event from a Snakemake log record's fields, or None to drop it.

    `fields` is the record's `__dict__` plus the rendered `message`. Snakemake attaches its
    own `event` value to structured records; records without one are plain console messages.
    """
    event_type = _EVENT_TYPES.get(str(fields.get("event") or ""))
    if event_type is None:
        return None

    event: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "timestamp": format_timestamp(fields.get("created")),
        "type": event_type,
    }

    if event_type == "workflow-started":
        event["snakemake_version"] = _text(fields.get("snakemake_version"))
        event["command"] = _text(fields.get("cmd"))
    elif event_type == "run-info":
        counts = _counts(fields.get("stats"))
        # Snakemake reports the overall total inside the same per-rule mapping.
        event["total"] = counts.pop("total", sum(counts.values()))
        event["jobs"] = counts
    elif event_type == "job-started":
        event["job_id"] = _integer(fields.get("jobid"))
        event["rule"] = _text(fields.get("rule_name"))
        event["threads"] = _integer(fields.get("threads"))
        event["reason"] = _text(fields.get("reason"))
        event["logs"] = _paths(fields.get("log"))
        event["outputs"] = _paths(fields.get("output"))
        event["wildcards"] = _wildcards(fields.get("wildcards"))
        # Snakemake reports the command only for shell rules, and only as it will run.
        event["command"] = _text(fields.get("shellcmd"))
    elif event_type == "job-finished":
        event["job_id"] = _integer(fields.get("job_id"))
    elif event_type == "job-failed":
        event["job_id"] = _integer(fields.get("jobid"))
        event["rule"] = _text(fields.get("rule_name"))
        event["logs"] = _paths(fields.get("log"))
        event["message"] = _text(fields.get("message"))
    elif event_type == "progress":
        event["done"] = _integer(fields.get("done"))
        event["total"] = _integer(fields.get("total"))
    elif event_type == "error":
        event["exception"] = _text(fields.get("exception"))
        event["message"] = _text(fields.get("message"))

    return event
