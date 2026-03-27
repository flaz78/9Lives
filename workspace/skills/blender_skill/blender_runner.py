import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

from .blender_commands import build_blender_command, build_executor_payload
from .utils import DEFAULT_ALLOWED_ROOT, make_error, make_success, read_json, write_json


class BlenderRunner:
    def __init__(
        self,
        blender_executable: Optional[str] = None,
        workspace_root: Optional[Path] = None,
    ) -> None:
        self.workspace_root = (workspace_root or DEFAULT_ALLOWED_ROOT).resolve()
        self.blender_executable = self._resolve_blender_executable(blender_executable)
        self.executor_script = Path(__file__).resolve().parent / "blender_executor.py"

    def _resolve_blender_executable(self, explicit_path: Optional[str]) -> Optional[Path]:
        candidates = [
            explicit_path,
            os.environ.get("BLENDER_EXECUTABLE"),
            shutil.which("blender"),
        ]
        for candidate in candidates:
            if not candidate:
                continue
            path_value = Path(candidate)
            if path_value.exists():
                return path_value.resolve()
            which_match = shutil.which(str(candidate))
            if which_match:
                return Path(which_match).resolve()
        return None

    def check_availability(self) -> Dict[str, Any]:
        if self.blender_executable is None:
            return make_error(
                "Blender executable not found. Set BLENDER_EXECUTABLE or install Blender in PATH.",
                code="BLENDER_NOT_FOUND",
                details={
                    "checked_env": "BLENDER_EXECUTABLE",
                    "workspace_root": str(self.workspace_root),
                },
            )

        try:
            completed = subprocess.run(
                [str(self.blender_executable), "--version"],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except Exception as exc:
            return make_error(
                f"Failed to execute Blender: {exc}",
                code="BLENDER_VERSION_FAILED",
                details={"blender_executable": str(self.blender_executable)},
            )

        if completed.returncode != 0:
            return make_error(
                "Blender executable returned a non-zero exit code when checking version.",
                code="BLENDER_VERSION_FAILED",
                details={
                    "blender_executable": str(self.blender_executable),
                    "returncode": completed.returncode,
                    "stderr": completed.stderr.strip(),
                },
            )

        first_line = completed.stdout.strip().splitlines()[0] if completed.stdout.strip() else "Unknown Blender version"
        return make_success(
            "Blender is available",
            data={
                "blender_executable": str(self.blender_executable),
                "version": first_line,
            },
        )

    def run_action(self, action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        availability = self.check_availability()
        if not availability["success"]:
            return availability

        timeout_seconds = int(payload.get("timeout_seconds", 120))
        executor_payload = build_executor_payload(action, payload, self.workspace_root)

        with tempfile.TemporaryDirectory(prefix="blender-skill-") as temp_dir:
            temp_root = Path(temp_dir)
            payload_path = temp_root / "payload.json"
            result_path = temp_root / "result.json"
            write_json(payload_path, executor_payload)

            command = build_blender_command(
                blender_executable=self.blender_executable,
                executor_script=self.executor_script,
                payload_path=payload_path,
                result_path=result_path,
            )

            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                return make_error(
                    f"Blender command timed out after {timeout_seconds} seconds",
                    code="BLENDER_TIMEOUT",
                    details={
                        "command": command,
                        "timeout_seconds": timeout_seconds,
                        "stdout": (exc.stdout or "").strip(),
                        "stderr": (exc.stderr or "").strip(),
                    },
                )
            except Exception as exc:
                return make_error(
                    f"Failed to launch Blender: {exc}",
                    code="BLENDER_EXEC_FAILED",
                    details={"command": command},
                )

            if result_path.exists():
                result = read_json(result_path)
            else:
                result = make_error(
                    "Blender did not produce a result file",
                    code="BLENDER_NO_RESULT",
                    details={"returncode": completed.returncode},
                )

            result.setdefault("data", {})
            result["data"]["stdout"] = completed.stdout.strip()
            result["data"]["stderr"] = completed.stderr.strip()
            result["data"]["command"] = command
            result["data"]["returncode"] = completed.returncode
            return result


def run_cli_action(action: str, payload: Dict[str, Any], blender_executable: Optional[str] = None) -> Dict[str, Any]:
    runner = BlenderRunner(blender_executable=blender_executable)
    if action == "check_availability":
        return runner.check_availability()
    return runner.run_action(action, payload)
