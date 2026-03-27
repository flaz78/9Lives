from pathlib import Path
from typing import Dict, List, Optional


def build_executor_payload(action: str, payload: Dict, workspace_root: Path) -> Dict:
    return {
        "action": action,
        "payload": payload,
        "workspace_root": str(workspace_root),
    }


def build_blender_command(
    blender_executable: Path,
    executor_script: Path,
    payload_path: Path,
    result_path: Path,
    extra_args: Optional[List[str]] = None,
) -> List[str]:
    command = [
        str(blender_executable),
        "--background",
        "--factory-startup",
        "--python",
        str(executor_script),
        "--",
        "--payload",
        str(payload_path),
        "--result",
        str(result_path),
    ]
    if extra_args:
        command.extend(extra_args)
    return command
