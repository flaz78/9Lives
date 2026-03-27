from copy import deepcopy
from typing import Any, Dict

from .utils import SkillError, coerce_float_tuple, coerce_number


SUPPORTED_OBJECT_TYPES = {"cube", "sphere", "cylinder", "plane", "cone", "torus", "text"}
SUPPORTED_LIGHT_TYPES = {"point", "sun", "area", "spot"}
SUPPORTED_RENDER_ENGINES = {"BLENDER_EEVEE", "EEVEE", "CYCLES"}
SUPPORTED_IMPORT_FORMATS = {"obj", "glb", "gltf"}
SUPPORTED_EXPORT_FORMATS = {"obj", "glb", "gltf", "fbx"}
SUPPORTED_MODIFY_OPERATIONS = {
    "move",
    "rotate",
    "scale",
    "delete",
    "duplicate",
    "rename",
    "set_origin",
    "parent",
}


def _require_string(payload: Dict[str, Any], field_name: str) -> str:
    value = payload.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise SkillError(f"'{field_name}' must be a non-empty string")
    return value.strip()


def _normalize_material(material: Dict[str, Any]) -> Dict[str, Any]:
    normalized = deepcopy(material)
    if "base_color" in normalized:
        normalized["base_color"] = coerce_float_tuple(normalized["base_color"], "base_color", 4)
    if "emission_color" in normalized:
        normalized["emission_color"] = coerce_float_tuple(normalized["emission_color"], "emission_color", 4)
    for field_name in ("metallic", "roughness", "transmission", "emission_strength", "ior"):
        if field_name in normalized:
            normalized[field_name] = coerce_number(normalized.get(field_name), field_name)
    return normalized


def _normalize_transform(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = deepcopy(payload)
    for field_name in ("location", "rotation", "scale", "dimensions"):
        if field_name in normalized:
            normalized[field_name] = coerce_float_tuple(normalized.get(field_name), field_name, 3)
    return normalized


def _normalize_object_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_transform(payload)
    object_type = _require_string(normalized, "type").lower()
    if object_type not in SUPPORTED_OBJECT_TYPES:
        raise SkillError(f"Unsupported object type '{object_type}'")
    normalized["type"] = object_type
    normalized["name"] = _require_string(normalized, "name")
    if object_type == "text":
        normalized["text"] = str(normalized.get("text", "Text"))
    if "material" in normalized:
        if not isinstance(normalized["material"], dict):
            raise SkillError("'material' must be an object")
        normalized["material"] = _normalize_material(normalized["material"])
    return normalized


def _normalize_light_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_transform(payload)
    light_type = _require_string(normalized, "type").lower()
    if light_type not in SUPPORTED_LIGHT_TYPES:
        raise SkillError(f"Unsupported light type '{light_type}'")
    normalized["type"] = light_type
    normalized["name"] = _require_string(normalized, "name")
    normalized["energy"] = coerce_number(normalized.get("energy"), "energy", default=1000.0)
    if "color" in normalized:
        normalized["color"] = coerce_float_tuple(normalized["color"], "color", 4)
    return normalized


def _normalize_camera_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_transform(payload)
    normalized["name"] = str(normalized.get("name", "Camera"))
    normalized["lens"] = coerce_number(normalized.get("lens"), "lens", default=50.0)
    normalized["set_active"] = bool(normalized.get("set_active", True))
    return normalized


def _normalize_render_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = deepcopy(payload)
    engine = str(normalized.get("engine", "CYCLES")).upper()
    if engine not in SUPPORTED_RENDER_ENGINES:
        raise SkillError(f"Unsupported render engine '{engine}'")
    normalized["engine"] = engine
    normalized["resolution_x"] = int(coerce_number(normalized.get("resolution_x"), "resolution_x", default=1920))
    normalized["resolution_y"] = int(coerce_number(normalized.get("resolution_y"), "resolution_y", default=1080))
    if "samples" in normalized:
        normalized["samples"] = int(coerce_number(normalized.get("samples"), "samples", default=64))
    normalized["transparent_background"] = bool(normalized.get("transparent_background", False))
    if "background_color" in normalized:
        normalized["background_color"] = coerce_float_tuple(normalized["background_color"], "background_color", 4)
    if "output_path" in normalized and not isinstance(normalized["output_path"], str):
        raise SkillError("'output_path' must be a string")
    return normalized


def _normalize_modify_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_transform(payload)
    normalized["target_name"] = _require_string(normalized, "target_name")
    operation = _require_string(normalized, "operation").lower()
    if operation not in SUPPORTED_MODIFY_OPERATIONS:
        raise SkillError(f"Unsupported modify operation '{operation}'")
    normalized["operation"] = operation
    if operation == "rename":
        normalized["new_name"] = _require_string(normalized, "new_name")
    if operation == "duplicate":
        normalized["new_name"] = str(normalized.get("new_name", f"{normalized['target_name']}_copy"))
    if operation == "set_origin":
        normalized["origin_mode"] = str(normalized.get("origin_mode", "ORIGIN_GEOMETRY")).upper()
    if operation == "parent":
        normalized["parent_name"] = _require_string(normalized, "parent_name")
    return normalized


def validate_action_payload(action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise SkillError("Payload must be a JSON object")

    normalized = deepcopy(payload)
    if "project_path" in normalized and normalized["project_path"] is not None and not isinstance(normalized["project_path"], str):
        raise SkillError("'project_path' must be a string")
    if "save_path" in normalized and normalized["save_path"] is not None and not isinstance(normalized["save_path"], str):
        raise SkillError("'save_path' must be a string")
    if "timeout_seconds" in normalized:
        normalized["timeout_seconds"] = int(coerce_number(normalized.get("timeout_seconds"), "timeout_seconds", default=120))

    if action == "check_availability":
        return normalized
    if action == "new_project":
        normalized["scene_name"] = str(normalized.get("scene_name", "Scene"))
        return normalized
    if action == "open_project":
        normalized["project_path"] = _require_string(normalized, "project_path")
        return normalized
    if action == "save_project":
        normalized["save_path"] = _require_string(normalized, "save_path")
        return normalized
    if action == "reset_scene":
        normalized["scene_name"] = str(normalized.get("scene_name", "Scene"))
        return normalized
    if action == "create_object":
        normalized["object"] = _normalize_object_spec(normalized.get("object", {}))
        return normalized
    if action == "modify_object":
        normalized["operation_data"] = _normalize_modify_spec(normalized.get("operation_data", {}))
        return normalized
    if action == "assign_material":
        normalized["object_name"] = _require_string(normalized, "object_name")
        material = normalized.get("material")
        if not isinstance(material, dict):
            raise SkillError("'material' must be an object")
        normalized["material"] = _normalize_material(material)
        return normalized
    if action == "create_light":
        normalized["light"] = _normalize_light_spec(normalized.get("light", {}))
        return normalized
    if action == "create_camera":
        normalized["camera"] = _normalize_camera_spec(normalized.get("camera", {}))
        return normalized
    if action == "render_still":
        normalized["render"] = _normalize_render_spec(normalized.get("render", {}))
        return normalized
    if action == "import_asset":
        normalized["input_path"] = _require_string(normalized, "input_path")
        normalized["format"] = str(normalized.get("format", "")).lower() or None
        if normalized["format"] and normalized["format"] not in SUPPORTED_IMPORT_FORMATS:
            raise SkillError(f"Unsupported import format '{normalized['format']}'")
        return normalized
    if action == "export_asset":
        normalized["output_path"] = _require_string(normalized, "output_path")
        fmt = str(normalized.get("format", "")).lower() or None
        if fmt and fmt not in SUPPORTED_EXPORT_FORMATS:
            raise SkillError(f"Unsupported export format '{fmt}'")
        normalized["format"] = fmt
        return normalized
    if action == "build_scene":
        normalized["scene_name"] = str(normalized.get("scene_name", "Scene"))
        normalized["objects"] = [_normalize_object_spec(item) for item in normalized.get("objects", [])]
        normalized["lights"] = [_normalize_light_spec(item) for item in normalized.get("lights", [])]
        if normalized.get("camera") is not None:
            if not isinstance(normalized["camera"], dict):
                raise SkillError("'camera' must be an object")
            normalized["camera"] = _normalize_camera_spec(normalized["camera"])
        if normalized.get("render") is not None:
            if not isinstance(normalized["render"], dict):
                raise SkillError("'render' must be an object")
            normalized["render"] = _normalize_render_spec(normalized["render"])
        normalized["reset_first"] = bool(normalized.get("reset_first", True))
        return normalized

    raise SkillError(f"Unsupported action '{action}'")
