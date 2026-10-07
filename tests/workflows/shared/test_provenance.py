import tempfile
import unittest
from pathlib import Path

from ._load import load_script

provenance = load_script("provenance")


class ConfiguredToolVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.envs = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _environment(self, name: str, content: str) -> None:
        directory = self.envs / name
        directory.mkdir()
        (directory / "environment.yaml").write_text(content, encoding="utf-8")

    def test_reads_conda_and_pip_pins_from_every_environment(self) -> None:
        self._environment(
            "aligner",
            "name: aligner\nchannels:\n  - conda-forge\n  - bioconda\ndependencies:\n"
            "  - python=3.11.16\n  - minimap2=2.31  # aligner\n  - pip\n  - pip:\n      - tool==1.2.3\n",
        )
        self._environment("fetch", "dependencies:\n  - python=3.11.16\n  - fetcher=18.0.0\n")

        self.assertEqual(
            provenance.configured_tool_versions([self.envs]),
            {"python": "3.11.16", "minimap2": "2.31", "tool": "1.2.3", "fetcher": "18.0.0"},
        )

    def test_rejects_a_package_pinned_differently_across_environments(self) -> None:
        self._environment("one", "dependencies:\n  - python=3.11.16\n")
        self._environment("two", "dependencies:\n  - python=3.12.1\n")

        with self.assertRaises(ValueError):
            provenance.configured_tool_versions([self.envs])

    def test_rejects_a_package_pinned_differently_across_directories(self) -> None:
        self._environment("one", "dependencies:\n  - python=3.11.16\n")
        with tempfile.TemporaryDirectory() as other:
            (Path(other) / "two").mkdir()
            (Path(other) / "two" / "environment.yaml").write_text("dependencies:\n  - python=3.12.1\n", encoding="utf-8")

            with self.assertRaises(ValueError):
                provenance.configured_tool_versions([self.envs, Path(other)])


if __name__ == "__main__":
    unittest.main()
