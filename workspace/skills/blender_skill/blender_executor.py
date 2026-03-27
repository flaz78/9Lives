import argparse
import traceback
from pathlib import Path

from .live_protocol import failure, read_json, write_json
from .scene_runtime import execute_action, open_project_if_requested


def parse_args():
    argv = []
    import sys
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--result", required=True)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    payload_doc = read_json(args.payload)

    try:
        workspace_root = Path(payload_doc["workspace_root"]).resolve()
        action = payload_doc["action"]
        payload = payload_doc["payload"]

        if action not in {"new_project", "open_project"} and payload.get("project_path"):
            open_project_if_requested(payload, workspace_root)

        result = execute_action(action, payload, workspace_root)
    except Exception as exc:
        result = failure(str(exc), code="BLENDER_EXECUTOR_ERROR", details={"traceback": traceback.format_exc()})

    write_json(args.result, result)


if __name__ == "__main__":
    main()
