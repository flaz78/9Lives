import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1].parent))

from blender_skill.live_protocol import failure, make_request_id, success


class LiveProtocolTests(unittest.TestCase):
    def test_make_request_id_has_prefix(self):
        value = make_request_id("live")
        self.assertTrue(value.startswith("live_"))

    def test_success_shape(self):
        result = success("ok", {"x": 1})
        self.assertTrue(result["success"])
        self.assertEqual(result["data"]["x"], 1)
        self.assertIsNone(result["error"])

    def test_failure_shape(self):
        result = failure("bad", code="ERR")
        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "ERR")


if __name__ == "__main__":
    unittest.main()
