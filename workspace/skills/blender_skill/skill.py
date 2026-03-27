import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from blender_skill.blender_runner import run_cli_action
    from blender_skill.schema import validate_action_payload
    from blender_skill.utils import SkillError, make_error
else:
    from .blender_runner import run_cli_action
    from .schema import validate_action_payload
    from .utils import SkillError, make_error


class BlenderSkill:
    def execute(self, action: str, payload: Dict[str, Any], blender_executable: Optional[str] = None) -> Dict[str, Any]:
        try:
            normalized_payload = validate_action_payload(action, payload)
        except SkillError as exc:
            return make_error(str(exc), code="BLENDER_VALIDATION_ERROR")

        return run_cli_action(action, normalized_payload, blender_executable=blender_executable)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="9Lives Blender skill CLI")
    parser.add_argument("--action", required=True, help="Action to execute")
    parser.add_argument("--payload-json", default="{}", help="JSON payload string")
    parser.add_argument("--blender-executable", default=None, help="Optional Blender executable path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        payload = json.loads(args.payload_json)
    except json.JSONDecodeError as exc:
        result = make_error(f"Invalid JSON payload: {exc}", code="BLENDER_INVALID_JSON")
        print(json.dumps(result))
        return 1

    skill = BlenderSkill()
    result = skill.execute(args.action, payload, blender_executable=args.blender_executable)
    print(json.dumps(result))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
