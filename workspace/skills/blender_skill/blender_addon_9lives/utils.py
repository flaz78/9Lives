import json
import os
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_ALLOWED_ROOT = Path(os.environ.get("BLENDER_SKILL_ROOT", Path.cwd())).resolve()


class SkillError(Exception):
    """Expected operational error for the Blender skill."""


def make_result(
    success: bool,
    message: str,
    data: Optional[Dict[str, Any]] = None,
    error: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "success": success,
        "message": message,
        "data": data or {},
        "error": error,
    }


def make_success(message: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return make_result(True, message, data=data, error=None)


def make_error(
    message: str,
    code: str = "BLENDER_SKILL_ERROR",
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return make_result(
        False,
        message,
        data={},
        error={
            "code": code,
            "details": details or {},
        },
    )


def ensure_directory(path_value: Path) -> Path:
    path_value.mkdir(parents=True, exist_ok=True)
    return path_value


def write_json(path_value: Path, payload: Dict[str, Any]) -> None:
    ensure_directory(path_value.parent)
    path_value.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def read_json(path_value: Path) -> Dict[str, Any]:
    return json.loads(path_value.read_text(encoding="utf-8"))


def resolve_safe_path(
    raw_path: str,
    *,
    root: Optional[Path] = None,
    must_exist: bool = False,
    create_parent: bool = False,
    allow_external: Optional[bool] = None,
) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise SkillError("Path must be a non-empty string")
    if "\x00" in raw_path:
        raise SkillError("Path contains invalid null bytes")

    base_root = (root or DEFAULT_ALLOWED_ROOT).resolve()
    candidate = Path(raw_path)
    resolved = (candidate if candidate.is_absolute() else base_root / candidate).resolve()

    external_allowed = allow_external
    if external_allowed is None:
        external_allowed = os.environ.get("BLENDER_ALLOW_EXTERNAL_PATHS", "false").lower() == "true"

    if not external_allowed:
        try:
            resolved.relative_to(base_root)
        except ValueError as exc:
            raise SkillError(
                f"Path '{raw_path}' resolves outside the allowed root '{base_root}'"
            ) from exc

    if must_exist and not resolved.exists():
        raise SkillError(f"Path does not exist: {resolved}")

    if create_parent:
        ensure_directory(resolved.parent)

    return resolved


def coerce_float_tuple(value: Any, name: str, expected_size: int) -> Optional[list]:
    if value is None:
        return None
    if not isinstance(value, (list, tuple)) or len(value) != expected_size:
        raise SkillError(f"'{name}' must be an array with {expected_size} numeric values")
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError) as exc:
        raise SkillError(f"'{name}' must contain only numeric values") from exc


def coerce_number(value: Any, name: str, default: Optional[float] = None) -> Optional[float]:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise SkillError(f"'{name}' must be numeric") from exc
