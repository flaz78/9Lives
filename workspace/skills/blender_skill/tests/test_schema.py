import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1].parent))

from blender_skill.schema import validate_action_payload
from blender_skill.utils import SkillError


class SchemaValidationTests(unittest.TestCase):
    def test_build_scene_normalizes_payload(self):
        payload = validate_action_payload(
            "build_scene",
            {
                "scene_name": "demo",
                "objects": [
                    {
                        "type": "cube",
                        "name": "cube_a",
                        "location": [0, 0, 1],
                        "material": {
                            "base_color": [1, 0, 0, 1],
                            "metallic": 0.5,
                        },
                    }
                ],
                "lights": [{"type": "area", "name": "key", "energy": 1000}],
                "camera": {"location": [1, -2, 3], "rotation": [1.1, 0, 0.2]},
                "render": {"engine": "cycles", "resolution_x": 800, "resolution_y": 600},
            },
        )
        self.assertEqual(payload["render"]["engine"], "CYCLES")
        self.assertEqual(payload["objects"][0]["type"], "cube")
        self.assertEqual(payload["lights"][0]["type"], "area")

    def test_invalid_object_type_raises(self):
        with self.assertRaises(SkillError):
            validate_action_payload(
                "create_object",
                {
                    "object": {
                        "type": "monkey",
                        "name": "bad",
                    }
                },
            )

    def test_modify_requires_target_name(self):
        with self.assertRaises(SkillError):
            validate_action_payload(
                "modify_object",
                {
                    "operation_data": {
                        "operation": "move",
                        "location": [1, 2, 3],
                    }
                },
            )


if __name__ == "__main__":
    unittest.main()
