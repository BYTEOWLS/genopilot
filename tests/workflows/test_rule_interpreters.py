"""Rules without a Conda environment must run their scripts on Snakemake's own interpreter.

A bare `python3` in such a rule resolves to whatever the host has on PATH: nothing on a
minimal Linux install, or a Python too old for the scripts on an older distribution.
"""

import re
import unittest
from pathlib import Path

WORKFLOWS_DIR = Path(__file__).resolve().parents[2] / "workflows"
RULE = re.compile(r"^rule (\w+):\n((?:[ \t]+.*\n|\n)*)", re.MULTILINE)
BARE_PYTHON = re.compile(r"(?<![\w{/.-])python3?(?![\w.-])")


def rule_blocks() -> dict[str, str]:
    blocks: dict[str, str] = {}
    for path in sorted([*WORKFLOWS_DIR.glob("**/*.smk"), *WORKFLOWS_DIR.glob("*/Snakefile")]):
        for match in RULE.finditer(path.read_text(encoding="utf-8")):
            blocks[f"{path.relative_to(WORKFLOWS_DIR)}:{match.group(1)}"] = match.group(2)
    return blocks


class RuleInterpreterTests(unittest.TestCase):
    def test_rules_without_an_environment_do_not_call_the_host_python(self) -> None:
        without_environment = {
            name: body for name, body in rule_blocks().items() if not re.search(r"^\s+conda:", body, re.MULTILINE)
        }
        self.assertTrue(
            any("{PYTHON_SH}" in body for body in without_environment.values()),
            "no rule without an environment was found running a script; the rule parser may be broken",
        )
        for name, body in without_environment.items():
            with self.subTest(rule=name):
                self.assertIsNone(BARE_PYTHON.search(body), f"{name} calls the host python; use {{PYTHON_SH}}")


if __name__ == "__main__":
    unittest.main()
