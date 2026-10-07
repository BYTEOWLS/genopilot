"""The committed reference-consensus fixtures are exactly what their generator produces."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

from ..shared._load import PROJECT_ROOT

FIXTURES_DIR = PROJECT_ROOT / "tests" / "fixtures" / "reference-consensus"


def load_generator():
    spec = importlib.util.spec_from_file_location("reference_consensus_fixtures", FIXTURES_DIR / "generate.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FixtureGeneratorTests(unittest.TestCase):
    def test_regenerating_reproduces_the_committed_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            load_generator().main(output)
            generated = sorted(path.relative_to(output) for path in output.rglob("*") if path.is_file())
            self.assertTrue(generated)
            for relative in generated:
                with self.subTest(file=str(relative)):
                    self.assertEqual((output / relative).read_bytes(), (FIXTURES_DIR / relative).read_bytes())


if __name__ == "__main__":
    unittest.main()
