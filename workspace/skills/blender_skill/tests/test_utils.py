import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1].parent))

from blender_skill.utils import SkillError, resolve_safe_path


class UtilsTests(unittest.TestCase):
    def test_resolve_safe_path_blocks_parent_escape(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with self.assertRaises(SkillError):
                resolve_safe_path("../escape.txt", root=root)

    def test_resolve_safe_path_creates_parent(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            resolved = resolve_safe_path("nested/file.txt", root=root, create_parent=True)
            self.assertTrue(resolved.parent.exists())
            self.assertTrue(str(resolved).startswith(str(root)))

    def test_absolute_path_allowed_only_when_enabled(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            external = Path(tempfile.gettempdir()) / "outside.txt"
            with self.assertRaises(SkillError):
                resolve_safe_path(str(external), root=root, allow_external=False)
            allowed = resolve_safe_path(str(external), root=root, allow_external=True)
            self.assertEqual(allowed, external.resolve())


if __name__ == "__main__":
    unittest.main()
