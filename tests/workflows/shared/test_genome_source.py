import os
import unittest
from unittest.mock import patch

from ._load import load_script

genome_source = load_script("genome_source")


class NodeExecutableTests(unittest.TestCase):
    def test_managed_executable_does_not_require_path_lookup(self):
        with patch.dict(os.environ, {"GENOPILOT_NODE_EXECUTABLE": "/runtime with spaces/node"}, clear=True), \
                patch.object(genome_source.shutil, "which") as lookup, \
                patch.object(genome_source.subprocess, "Popen", side_effect=OSError("injected spawn failure")) as spawn:
            with self.assertRaisesRegex(OSError, "injected spawn failure"):
                genome_source.copy_genome({}, {})
            lookup.assert_not_called()
            self.assertEqual(spawn.call_args.args[0][0], "/runtime with spaces/node")
            self.assertTrue(spawn.call_args.args[0][1].endswith("/dist/genome-source.js"))

    def test_direct_execution_uses_node_on_path(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(genome_source.shutil, "which", return_value="/direct/node") as lookup, \
                patch.object(genome_source.subprocess, "Popen", side_effect=OSError("injected spawn failure")) as spawn:
            with self.assertRaisesRegex(OSError, "injected spawn failure"):
                genome_source.copy_genome({}, {})
            lookup.assert_called_once_with("node")
            self.assertEqual(spawn.call_args.args[0][0], "/direct/node")

    def test_missing_node_explains_configuration_without_spawning(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(genome_source.shutil, "which", return_value=None), \
                patch.object(genome_source.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(RuntimeError, "GENOPILOT_NODE_EXECUTABLE"):
                genome_source.copy_genome({}, {})
            spawn.assert_not_called()
