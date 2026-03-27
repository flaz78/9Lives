# blender_skill

`blender_skill` now supports two production modes for 9Lives:

1. Batch mode
   9Lives launches Blender headlessly with `--background --python ...` for deterministic offline jobs.
2. Live mode
   A Blender addon runs a local authenticated bridge so 9Lives can control a live GUI session in realtime.

## Architecture

### Batch path

- 9Lives tools: `apps/gateway/src/runtime/blenderTools.ts`
- Python orchestration: `skill.py`, `schema.py`, `blender_runner.py`, `blender_commands.py`, `utils.py`
- Blender executor: `blender_executor.py`
- Shared Blender runtime: `scene_runtime.py`

### Live path

- Blender addon: `workspace/skills/blender_skill/blender_addon_9lives/`
- 9Lives tools: `apps/gateway/src/runtime/blenderLiveTools.ts`
- Transport: local HTTP bridge on `127.0.0.1` by default
- Auth: bearer token configured in addon and gateway env
- Main-thread safety: HTTP thread enqueues work, `bpy.app.timers` executes on Blender main thread

This split is deliberate:

- use batch for renders, exports, and repeatable pipelines
- use live for interactive scene editing, incremental changes, scene inspection, and viewport previews

## Files

Core skill files:

- `__init__.py`
- `skill.py`
- `schema.py`
- `utils.py`
- `blender_commands.py`
- `blender_runner.py`
- `blender_executor.py`
- `scene_runtime.py`
- `live_protocol.py`
- `SKILL.md`
- `README.md`
- `package_addon.py`
- `examples/`
- `tests/`

Live addon files:

- `blender_addon_9lives/__init__.py`
- `blender_addon_9lives/README.md`
- `blender_addon_9lives/live_protocol.py`
- `blender_addon_9lives/scene_runtime.py`
- `blender_addon_9lives/schema.py`
- `blender_addon_9lives/utils.py`

Gateway integration:

- `apps/gateway/src/runtime/blenderTools.ts`
- `apps/gateway/src/runtime/blenderLiveTools.ts`

## Prerequisites

### Batch mode

- Python 3.8+
- Blender installed locally where batch jobs run
- `BLENDER_EXECUTABLE` set if Blender is not in PATH

### Live mode

- Blender running on the local machine
- `9Lives Live Bridge` addon installed and enabled
- reachable local network path from gateway to Blender host
- matching `BLENDER_LIVE_BASE_URL` and `BLENDER_LIVE_TOKEN`

## Configuration

### Batch env

- `BLENDER_EXECUTABLE`
- `BLENDER_SKILL_ROOT`
- `BLENDER_ALLOW_EXTERNAL_PATHS`
- `BLENDER_SKILL_TIMEOUT_MS`
- `PYTHON_EXECUTABLE`

### Live env

- `BLENDER_LIVE_BASE_URL`
- `BLENDER_LIVE_TOKEN`
- `BLENDER_LIVE_TIMEOUT_MS`

Example:

```powershell
$env:BLENDER_LIVE_BASE_URL="http://127.0.0.1:8765"
$env:BLENDER_LIVE_TOKEN="replace-with-addon-token"
```

## Live addon install

1. Build the addon zip:

```bash
python workspace/skills/blender_skill/package_addon.py
```

2. In Blender open `Edit > Preferences > Add-ons > Install...`
3. Install `workspace/skills/blender_skill/dist/blender_addon_9lives.zip`
4. Enable `9Lives Live Bridge`
5. Open the `9Lives` panel in the 3D View sidebar
6. Configure host, port, token, and optional workspace root
7. Start the bridge

## Realtime endpoints

The addon exposes:

- `GET /health`
- `GET /scene`
- `POST /execute`

Supported live actions include:

- `ping`
- `get_scene_state`
- `select_objects`
- `viewport_preview`
- `new_project`
- `open_project`
- `save_project`
- `reset_scene`
- `create_object`
- `modify_object`
- `assign_material`
- `create_light`
- `create_camera`
- `render_still`
- `import_asset`
- `export_asset`
- `build_scene`

## Usage examples

1. Create cube and render it in batch
   Use `blender.buildScene` with `examples/create_cube_render.json`
2. Create a minimal product scene in batch
   Use `blender.buildScene` with `examples/minimal_product_scene.json`
3. Import OBJ and generate preview
   Use `blender.importAsset`, `blender.assignMaterial`, `blender.renderStill`
4. Export GLB
   Use `blender.exportAsset` with `examples/export_glb.json`
5. Build full scene from structured JSON
   Use `blender.buildScene` with `examples/build_scene_from_json.json`
6. Inspect a live scene
   Use `blender.liveStatus` then `blender.liveSceneState`
7. Create an object in a live Blender session
   Use `blender.liveCreateObject`
8. Capture a live viewport preview
   Use `blender.liveViewportPreview`

## Limits

- Live mode requires Blender to be open with the addon enabled
- The live bridge intentionally exposes only whitelisted actions, not arbitrary Python execution
- Material support remains focused on Principled BSDF basics
- No animation, geometry nodes, modifiers, or physics orchestration yet

## Future extensions

- WebSocket streaming for lower-latency updates
- Viewport snapshot streaming
- Collection management and asset browser support
- Geometry nodes and modifier stacks
- Animation timelines and camera rigs
- MCP server wrapper above the live bridge for standardized remote tool discovery
