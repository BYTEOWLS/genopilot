import tempfile
import unittest
from pathlib import Path

from ._load import load_script

require_passed_validation = load_script("require_passed_validation")


class MainTests(unittest.TestCase):
    def run_with(self, content: str | None) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "input-validation.json"
            if content is not None:
                report.write_text(content, encoding="utf-8")
            return require_passed_validation.main([str(report)])

    def test_a_passed_report_allows_the_next_step(self) -> None:
        self.assertEqual(self.run_with('{"status": "passed"}'), 0)

    def test_a_failed_report_stops_the_next_step(self) -> None:
        self.assertEqual(self.run_with('{"status": "failed"}'), 1)

    def test_a_missing_unreadable_or_statusless_report_stops_the_next_step(self) -> None:
        for content in (None, "not json", "[]", "{}"):
            with self.subTest(content=content):
                self.assertEqual(self.run_with(content), 1)


if __name__ == "__main__":
    unittest.main()
