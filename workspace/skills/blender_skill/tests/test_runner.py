import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1].parent))

from blender_skill.blender_commands import build_blender_command
from blender_skill.blender_runner import BlenderRunner


class RunnerTests(unittest.TestCase):
    def test_build_blender_command_contains_expected_flags(self):
        command = build_blender_command(
            Path("/bin/blender"),
            Path("/tmp/executor.py"),
            Path("/tmp/payload.json"),
            Path("/tmp/result.json"),
        )
        self.assertIn("--background", command)
        self.assertIn("--python", command)
        self.assertIn(str(Path("/tmp/executor.py")), command)

    @patch("blender_skill.blender_runner.subprocess.run")
    def test_check_availability_returns_version(self, mock_run):
        mock_run.return_value = Mock(returncode=0, stdout="Blender 4.2.1\n", stderr="")
        with tempfile.TemporaryDirectory() as temp_dir:
            stub = Path(temp_dir) / "blender.exe"
            stub.write_text("", encoding="utf-8")
            runner = BlenderRunner(blender_executable=str(stub))
            result = runner.check_availability()
        self.assertTrue(result["success"])
        self.assertEqual(result["data"]["version"], "Blender 4.2.1")

    @patch("blender_skill.blender_runner.subprocess.run")
    def test_run_action_timeout_returns_structured_error(self, mock_run):
        from subprocess import TimeoutExpired

        mock_run.side_effect = [
            Mock(returncode=0, stdout="Blender 4.2.1\n", stderr=""),
            TimeoutExpired(cmd=["blender"], timeout=5),
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            stub = Path(temp_dir) / "blender.exe"
            stub.write_text("", encoding="utf-8")
            runner = BlenderRunner(blender_executable=str(stub))
            result = runner.run_action("new_project", {"scene_name": "demo", "timeout_seconds": 5})
        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "BLENDER_TIMEOUT")


if __name__ == "__main__":
    unittest.main()

