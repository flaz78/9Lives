
bl_info = {
    "name": "9Lives Live Bridge",
    "author": "OpenAI / 9Lives",
    "version": (0, 1, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > 9Lives",
    "description": "Realtime bridge between 9Lives agents and Blender",
    "category": "3D View",
}

import json
import queue
import secrets
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import bpy
from bpy.props import BoolProperty, IntProperty, StringProperty
from bpy.types import AddonPreferences, Operator, Panel, PropertyGroup

from .live_protocol import failure, make_request_id, success
from .schema import validate_action_payload
from .scene_runtime import execute_action
from .utils import SkillError


class _BridgeState:
    def __init__(self):
        self.server = None
        self.thread = None
        self.command_queue = queue.Queue()
        self.pending = {}
        self.lock = threading.Lock()
        self.running = False

    def reset(self):
        self.server = None
        self.thread = None
        self.pending = {}
        self.running = False


BRIDGE_STATE = _BridgeState()
TIMER_REGISTERED = False


def _prefs(context=None):
    context = context or bpy.context
    return context.preferences.addons[__name__].preferences


class BlenderLiveBridgePreferences(AddonPreferences):
    bl_idname = __name__

    host: StringProperty(name="Host", default="127.0.0.1")
    port: IntProperty(name="Port", default=8765, min=1, max=65535)
    token: StringProperty(name="Token", default="")
    workspace_root: StringProperty(name="Workspace Root", default="")
    auto_start: BoolProperty(name="Auto Start", default=False)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "host")
        layout.prop(self, "port")
        layout.prop(self, "token")
        layout.prop(self, "workspace_root")
        layout.prop(self, "auto_start")
        layout.operator("blender_live_bridge.generate_token", text="Generate Token")


class BlenderLiveBridgeState(PropertyGroup):
    status: StringProperty(default="stopped")
    last_message: StringProperty(default="Bridge not running")

def _scene_state():
    scene = bpy.context.scene
    return {
        "scene_name": scene.name,
        "filepath": bpy.data.filepath,
        "objects": sorted(obj.name for obj in bpy.data.objects),
        "selected_objects": sorted(obj.name for obj in bpy.context.selected_objects),
        "active_object": bpy.context.active_object.name if bpy.context.active_object else None,
        "active_camera": scene.camera.name if scene.camera else None,
    }


def _auth_token():
    return _prefs().token.strip()


def _workspace_root():
    raw = _prefs().workspace_root.strip()
    if raw:
        return Path(raw).resolve()
    if bpy.data.filepath:
        return Path(bpy.data.filepath).resolve().parent
    return Path.home().resolve()


def _handle_action(request_doc):
    action = request_doc.get("action")
    payload = request_doc.get("payload") or {}
    if action in {"ping", "get_scene_state", "select_objects", "viewport_preview"}:
        return execute_action(action, payload, _workspace_root())
    try:
        normalized_payload = validate_action_payload(action, payload)
    except SkillError as exc:
        return failure(str(exc), code="BLENDER_VALIDATION_ERROR")
    try:
        return execute_action(action, normalized_payload, _workspace_root())
    except Exception as exc:
        return failure(str(exc), code="BLENDER_ACTION_FAILED", details={"traceback": traceback.format_exc()})


class _BridgeRequestHandler(BaseHTTPRequestHandler):
    server_version = "9LivesBlenderBridge/0.1"

    def _json_response(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _authorize(self):
        expected = _auth_token()
        if not expected:
            return True
        return self.headers.get("Authorization", "") == f"Bearer {expected}"

    def do_GET(self):
        if not self._authorize():
            self._json_response(401, failure("Unauthorized", code="BLENDER_LIVE_UNAUTHORIZED"))
            return
        path = urlparse(self.path).path
        if path == "/health":
            self._json_response(200, success("Bridge healthy", {"bridge": {"running": BRIDGE_STATE.running, "host": _prefs().host, "port": _prefs().port}}))
            return
        if path == "/scene":
            request_doc = {"action": "get_scene_state", "payload": {}, "timeout_seconds": 30}
            request_id = make_request_id("bridge")
            response_event = threading.Event()
            with BRIDGE_STATE.lock:
                BRIDGE_STATE.pending[request_id] = {"event": response_event, "result": None}
            BRIDGE_STATE.command_queue.put({"request_id": request_id, "request": request_doc})
            completed = response_event.wait(30)
            with BRIDGE_STATE.lock:
                pending = BRIDGE_STATE.pending.pop(request_id, None)
            if not completed or pending is None or pending["result"] is None:
                self._json_response(504, failure("Timed out waiting for Blender scene state", code="BLENDER_LIVE_TIMEOUT", details={"request_id": request_id}))
                return
            self._json_response(200, pending["result"])
            return
        self._json_response(404, failure("Endpoint not found", code="BLENDER_LIVE_NOT_FOUND"))

    def do_POST(self):
        if not self._authorize():
            self._json_response(401, failure("Unauthorized", code="BLENDER_LIVE_UNAUTHORIZED"))
            return
        if urlparse(self.path).path != "/execute":
            self._json_response(404, failure("Endpoint not found", code="BLENDER_LIVE_NOT_FOUND"))
            return
        try:
            request_doc = self._read_json()
        except Exception as exc:
            self._json_response(400, failure(f"Invalid JSON body: {exc}", code="BLENDER_LIVE_INVALID_JSON"))
            return

        request_id = request_doc.get("request_id") or make_request_id("bridge")
        response_event = threading.Event()
        with BRIDGE_STATE.lock:
            BRIDGE_STATE.pending[request_id] = {"event": response_event, "result": None}
        BRIDGE_STATE.command_queue.put({"request_id": request_id, "request": request_doc})

        timeout_seconds = min(max(int(request_doc.get("timeout_seconds", 120)), 1), 1800)
        completed = response_event.wait(timeout_seconds)
        with BRIDGE_STATE.lock:
            pending = BRIDGE_STATE.pending.pop(request_id, None)

        if not completed or pending is None or pending["result"] is None:
            self._json_response(504, failure("Timed out waiting for Blender main-thread execution", code="BLENDER_LIVE_TIMEOUT", details={"request_id": request_id}))
            return

        self._json_response(200, pending["result"])

    def log_message(self, format, *args):
        return


def _bridge_timer():
    while True:
        try:
            item = BRIDGE_STATE.command_queue.get_nowait()
        except queue.Empty:
            break

        request_id = item["request_id"]
        request_doc = item["request"]
        try:
            result = _handle_action(request_doc)
        except Exception as exc:
            result = failure(str(exc), code="BLENDER_LIVE_INTERNAL_ERROR", details={"traceback": traceback.format_exc()})
        result["request_id"] = request_id

        with BRIDGE_STATE.lock:
            pending = BRIDGE_STATE.pending.get(request_id)
            if pending is not None:
                pending["result"] = result
                pending["event"].set()

    return 0.1 if BRIDGE_STATE.running else None


def ensure_timer():
    global TIMER_REGISTERED
    if TIMER_REGISTERED:
        return
    bpy.app.timers.register(_bridge_timer, persistent=True)
    TIMER_REGISTERED = True


def start_bridge():
    if BRIDGE_STATE.running:
        return success("Bridge already running", {"host": _prefs().host, "port": _prefs().port})
    prefs = _prefs()
    if not prefs.token.strip():
        prefs.token = secrets.token_urlsafe(24)
    server = ThreadingHTTPServer((prefs.host, prefs.port), _BridgeRequestHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, name="9LivesBlenderBridge", daemon=True)
    thread.start()

    BRIDGE_STATE.server = server
    BRIDGE_STATE.thread = thread
    BRIDGE_STATE.running = True
    state = bpy.context.window_manager.blender_live_bridge_state
    state.status = "running"
    state.last_message = f"Running on {prefs.host}:{prefs.port}"
    ensure_timer()
    return success("Bridge started", {"host": prefs.host, "port": prefs.port, "token": prefs.token})


def stop_bridge():
    if BRIDGE_STATE.server is not None:
        BRIDGE_STATE.server.shutdown()
        BRIDGE_STATE.server.server_close()
    BRIDGE_STATE.reset()
    state = bpy.context.window_manager.blender_live_bridge_state
    state.status = "stopped"
    state.last_message = "Bridge stopped"
    return success("Bridge stopped")


class BLENDERLIVEBRIDGE_OT_generate_token(Operator):
    bl_idname = "blender_live_bridge.generate_token"
    bl_label = "Generate Token"

    def execute(self, context):
        _prefs(context).token = secrets.token_urlsafe(24)
        self.report({"INFO"}, "Generated new bridge token")
        return {"FINISHED"}


class BLENDERLIVEBRIDGE_OT_start(Operator):
    bl_idname = "blender_live_bridge.start"
    bl_label = "Start 9Lives Bridge"

    def execute(self, context):
        result = start_bridge()
        if result["success"]:
            self.report({"INFO"}, result["message"])
            return {"FINISHED"}
        self.report({"ERROR"}, result["message"])
        return {"CANCELLED"}


class BLENDERLIVEBRIDGE_OT_stop(Operator):
    bl_idname = "blender_live_bridge.stop"
    bl_label = "Stop 9Lives Bridge"

    def execute(self, context):
        result = stop_bridge()
        self.report({"INFO"}, result["message"])
        return {"FINISHED"}


class BLENDERLIVEBRIDGE_PT_panel(Panel):
    bl_label = "9Lives"
    bl_idname = "BLENDERLIVEBRIDGE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "9Lives"

    def draw(self, context):
        layout = self.layout
        prefs = _prefs(context)
        state = context.window_manager.blender_live_bridge_state
        layout.label(text=f"Status: {state.status}")
        layout.label(text=state.last_message)
        layout.prop(prefs, "host")
        layout.prop(prefs, "port")
        layout.prop(prefs, "workspace_root")
        layout.prop(prefs, "token")
        layout.operator("blender_live_bridge.generate_token")
        row = layout.row()
        row.operator("blender_live_bridge.start")
        row.operator("blender_live_bridge.stop")

CLASSES = [
    BlenderLiveBridgePreferences,
    BlenderLiveBridgeState,
    BLENDERLIVEBRIDGE_OT_generate_token,
    BLENDERLIVEBRIDGE_OT_start,
    BLENDERLIVEBRIDGE_OT_stop,
    BLENDERLIVEBRIDGE_PT_panel,
]


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.WindowManager.blender_live_bridge_state = bpy.props.PointerProperty(type=BlenderLiveBridgeState)
    state = bpy.context.window_manager.blender_live_bridge_state
    state.status = "stopped"
    state.last_message = "Bridge not running"
    if _prefs().auto_start:
        try:
            start_bridge()
        except Exception as exc:
            state.last_message = f"Auto-start failed: {exc}"


def unregister():
    if BRIDGE_STATE.running:
        stop_bridge()
    del bpy.types.WindowManager.blender_live_bridge_state
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()


