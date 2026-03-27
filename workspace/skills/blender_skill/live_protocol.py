import json
import uuid
from pathlib import Path
from typing import Any, Dict


def success(message: str, data: Dict[str, Any] = None) -> Dict[str, Any]:
    return {"success": True, "message": message, "data": data or {}, "error": None}


def failure(message: str, code: str = "BLENDER_LIVE_ERROR", details: Dict[str, Any] = None) -> Dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "data": {},
        "error": {"code": code, "details": details or {}},
    }


def read_json(path_value: str) -> Dict[str, Any]:
    return json.loads(Path(path_value).read_text(encoding="utf-8"))


def write_json(path_value: str, payload: Dict[str, Any]) -> None:
    Path(path_value).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def make_request_id(prefix: str = "req") -> str:
    return f"{prefix}_{uuid.uuid4().hex}"
