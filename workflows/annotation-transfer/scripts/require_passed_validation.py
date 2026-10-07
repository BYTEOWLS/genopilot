#!/usr/bin/env python3
"""Stop a step unless the validation report it depends on passed.

The validation scripts always succeed and record their outcome in the
report, so Snakemake keeps a failed report as evidence instead of deleting
the output of a failed job. The rule that consumes the validated files runs
this first: a failed or unreadable report fails that rule before its tool
starts, while the report itself stays in place. Only Python's standard
library is used.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def validation_problem(report: Path) -> str | None:
    """Returns why the report does not allow the next step, or None when it passed."""
    try:
        status = json.loads(report.read_text(encoding="utf-8")).get("status")
    except (OSError, ValueError, AttributeError) as error:
        return f"{report} cannot be read as a validation report: {error}"
    if status != "passed":
        return f"{report} has status {status!r}; fix the problems it lists before this step can run"
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fail unless a validation report passed.")
    parser.add_argument("report", type=Path)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    problem = validation_problem(args.report)
    if problem:
        print(problem, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
