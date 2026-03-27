from pathlib import Path

import bpy

from .live_protocol import failure, success


def get_scene():
    return bpy.context.scene


def resolve_path(raw_path, workspace_root, create_parent=False):
    path_value = Path(raw_path)
    resolved = (path_value if path_value.is_absolute() else workspace_root / path_value).resolve()
    if create_parent:
        resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def open_project_if_requested(payload, workspace_root):
    project_path = payload.get("project_path")
    if project_path:
        resolved = resolve_path(project_path, workspace_root)
        bpy.ops.wm.open_mainfile(filepath=str(resolved))


def save_project_if_requested(payload, workspace_root):
    save_path = payload.get("save_path")
    if save_path:
        resolved = resolve_path(save_path, workspace_root, create_parent=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(resolved))
        return str(resolved)
    return None


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block_collection in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.curves,
    ):
        for block in list(block_collection):
            if block.users == 0:
                block_collection.remove(block)


def apply_transform(obj, spec):
    if spec.get("location") is not None:
        obj.location = spec["location"]
    if spec.get("rotation") is not None:
        obj.rotation_euler = spec["rotation"]
    if spec.get("scale") is not None:
        obj.scale = spec["scale"]
    if spec.get("dimensions") is not None:
        obj.dimensions = spec["dimensions"]


def get_active_object():
    obj = bpy.context.active_object
    if obj is None:
        raise RuntimeError("No active object available after Blender operation")
    return obj


def create_object(spec):
    object_type = spec["type"]
    if object_type == "cube":
        bpy.ops.mesh.primitive_cube_add()
    elif object_type == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add()
    elif object_type == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add()
    elif object_type == "plane":
        bpy.ops.mesh.primitive_plane_add()
    elif object_type == "cone":
        bpy.ops.mesh.primitive_cone_add()
    elif object_type == "torus":
        bpy.ops.mesh.primitive_torus_add()
    elif object_type == "text":
        bpy.ops.object.text_add()
        get_active_object().data.body = spec.get("text", "Text")
    else:
        raise RuntimeError(f"Unsupported object type: {object_type}")

    obj = get_active_object()
    obj.name = spec["name"]
    apply_transform(obj, spec)
    if spec.get("material"):
        material = ensure_material(spec["material"], f"{spec['name']}_material")
        assign_material(obj, material)
    return obj


def find_object(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError(f"Object '{name}' not found")
    return obj


def ensure_material(spec, material_name):
    material = bpy.data.materials.get(material_name) or bpy.data.materials.new(material_name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        raise RuntimeError("Principled BSDF node not available")

    if spec.get("base_color") is not None:
        principled.inputs["Base Color"].default_value = spec["base_color"]
    if spec.get("metallic") is not None:
        principled.inputs["Metallic"].default_value = spec["metallic"]
    if spec.get("roughness") is not None:
        principled.inputs["Roughness"].default_value = spec["roughness"]
    if spec.get("transmission") is not None and "Transmission Weight" in principled.inputs:
        principled.inputs["Transmission Weight"].default_value = spec["transmission"]
    elif spec.get("transmission") is not None and "Transmission" in principled.inputs:
        principled.inputs["Transmission"].default_value = spec["transmission"]
    if spec.get("ior") is not None and "IOR" in principled.inputs:
        principled.inputs["IOR"].default_value = spec["ior"]
    emission_color = spec.get("emission_color", spec.get("base_color"))
    if emission_color is not None:
        if "Emission Color" in principled.inputs:
            principled.inputs["Emission Color"].default_value = emission_color
        elif "Emission" in principled.inputs:
            principled.inputs["Emission"].default_value = emission_color
    if spec.get("emission_strength") is not None and "Emission Strength" in principled.inputs:
        principled.inputs["Emission Strength"].default_value = spec["emission_strength"]
    return material


def assign_material(obj, material):
    if obj.data is None or not hasattr(obj.data, "materials"):
        raise RuntimeError(f"Object '{obj.name}' does not support materials")
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)


def modify_object(spec):
    obj = find_object(spec["target_name"])
    operation = spec["operation"]

    if operation == "move":
        if spec.get("location") is None:
            raise RuntimeError("'location' is required for move")
        obj.location = spec["location"]
        return {"object_name": obj.name}
    if operation == "rotate":
        if spec.get("rotation") is None:
            raise RuntimeError("'rotation' is required for rotate")
        obj.rotation_euler = spec["rotation"]
        return {"object_name": obj.name}
    if operation == "scale":
        if spec.get("scale") is None:
            raise RuntimeError("'scale' is required for scale")
        obj.scale = spec["scale"]
        return {"object_name": obj.name}
    if operation == "delete":
        bpy.data.objects.remove(obj, do_unlink=True)
        return {"deleted": spec["target_name"]}
    if operation == "duplicate":
        duplicate = obj.copy()
        if obj.data is not None:
            duplicate.data = obj.data.copy()
        duplicate.name = spec.get("new_name", f"{obj.name}_copy")
        bpy.context.collection.objects.link(duplicate)
        apply_transform(duplicate, spec)
        return {"object_name": duplicate.name}
    if operation == "rename":
        obj.name = spec["new_name"]
        return {"object_name": obj.name}
    if operation == "set_origin":
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.origin_set(type=spec.get("origin_mode", "ORIGIN_GEOMETRY"))
        return {"object_name": obj.name}
    if operation == "parent":
        parent = find_object(spec["parent_name"])
        obj.parent = parent
        return {"object_name": obj.name, "parent_name": parent.name}

    raise RuntimeError(f"Unsupported modify operation '{operation}'")


def create_light(spec):
    light_data = bpy.data.lights.new(name=spec["name"], type=spec["type"].upper())
    light_data.energy = spec.get("energy", 1000.0)
    if spec.get("color") is not None:
        light_data.color = spec["color"][:3]
    light_object = bpy.data.objects.new(spec["name"], light_data)
    bpy.context.collection.objects.link(light_object)
    apply_transform(light_object, spec)
    return light_object


def create_camera(spec):
    camera_data = bpy.data.cameras.new(spec.get("name", "Camera"))
    camera_data.lens = spec.get("lens", 50.0)
    camera_object = bpy.data.objects.new(spec.get("name", "Camera"), camera_data)
    bpy.context.collection.objects.link(camera_object)
    apply_transform(camera_object, spec)
    if spec.get("set_active", True):
        get_scene().camera = camera_object
    return camera_object


def set_world_background(render_spec):
    world = get_scene().world
    if world is None:
        world = bpy.data.worlds.new("World")
        get_scene().world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None and render_spec.get("background_color") is not None:
        background.inputs[0].default_value = render_spec["background_color"]


def configure_render(render_spec, workspace_root):
    scene = get_scene()
    scene.render.engine = "BLENDER_EEVEE" if render_spec["engine"] == "EEVEE" else render_spec["engine"]
    scene.render.resolution_x = render_spec.get("resolution_x", 1920)
    scene.render.resolution_y = render_spec.get("resolution_y", 1080)
    scene.render.film_transparent = render_spec.get("transparent_background", False)
    if render_spec.get("background_color") is not None:
        set_world_background(render_spec)

    if "samples" in render_spec:
        if scene.render.engine == "CYCLES":
            scene.cycles.samples = render_spec["samples"]
        elif hasattr(scene, "eevee"):
            scene.eevee.taa_render_samples = render_spec["samples"]

    output_path = None
    if render_spec.get("output_path"):
        output_path = resolve_path(render_spec["output_path"], workspace_root, create_parent=True)
        file_format = output_path.suffix.replace(".", "").upper() or "PNG"
        scene.render.image_settings.file_format = "JPEG" if file_format == "JPG" else file_format
        scene.render.filepath = str(output_path)
    return output_path


def import_asset(payload, workspace_root):
    input_path = resolve_path(payload["input_path"], workspace_root)
    if not input_path.exists():
        raise RuntimeError(f"Input asset not found: {input_path}")
    file_format = payload.get("format") or input_path.suffix.replace(".", "").lower()
    before = set(obj.name for obj in bpy.data.objects)

    if file_format == "obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=str(input_path))
        else:
            bpy.ops.import_scene.obj(filepath=str(input_path))
    elif file_format in {"glb", "gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(input_path))
    else:
        raise RuntimeError(f"Unsupported import format '{file_format}'")

    after = set(obj.name for obj in bpy.data.objects)
    imported = sorted(after - before)
    return {"input_path": str(input_path), "format": file_format, "imported_objects": imported}


def export_asset(payload, workspace_root):
    output_path = resolve_path(payload["output_path"], workspace_root, create_parent=True)
    file_format = payload.get("format") or output_path.suffix.replace(".", "").lower()

    if file_format == "obj":
        if hasattr(bpy.ops.wm, "obj_export"):
            bpy.ops.wm.obj_export(filepath=str(output_path))
        else:
            bpy.ops.export_scene.obj(filepath=str(output_path))
    elif file_format in {"glb", "gltf"}:
        export_format = "GLB" if file_format == "glb" else "GLTF_SEPARATE"
        bpy.ops.export_scene.gltf(filepath=str(output_path), export_format=export_format)
    elif file_format == "fbx":
        bpy.ops.export_scene.fbx(filepath=str(output_path))
    else:
        raise RuntimeError(f"Unsupported export format '{file_format}'")

    return {"output_path": str(output_path), "format": file_format}


def scene_summary():
    scene = get_scene()
    return {
        "scene_name": scene.name,
        "objects": sorted(obj.name for obj in bpy.data.objects),
        "active_camera": scene.camera.name if scene.camera else None,
        "selected_objects": sorted(obj.name for obj in bpy.context.selected_objects),
        "filepath": bpy.data.filepath,
    }


def build_scene(payload, workspace_root):
    if payload.get("reset_first", True):
        clear_scene()
    get_scene().name = payload.get("scene_name", "Scene")

    created_objects = []
    created_lights = []
    camera_name = None
    render_output = None

    for object_spec in payload.get("objects", []):
        created_objects.append(create_object(object_spec).name)
    for light_spec in payload.get("lights", []):
        created_lights.append(create_light(light_spec).name)
    if payload.get("camera"):
        camera_name = create_camera(payload["camera"]).name
    if payload.get("render"):
        render_output = configure_render(payload["render"], workspace_root)
        if render_output:
            bpy.ops.render.render(write_still=True)

    return {
        "created_objects": created_objects,
        "created_lights": created_lights,
        "camera_name": camera_name,
        "render_output_path": str(render_output) if render_output else None,
    }


def viewport_preview(payload, workspace_root):
    output_path = resolve_path(payload["output_path"], workspace_root, create_parent=True)
    scene = get_scene()
    previous_filepath = scene.render.filepath
    previous_format = scene.render.image_settings.file_format
    scene.render.filepath = str(output_path)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.opengl(write_still=True)
    scene.render.filepath = previous_filepath
    scene.render.image_settings.file_format = previous_format
    return {"output_path": str(output_path)}


def select_objects(payload):
    names = payload.get("object_names", [])
    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            obj.select_set(True)
            selected.append(name)
    if selected:
        bpy.context.view_layer.objects.active = bpy.data.objects[selected[0]]
    return {"selected_objects": selected}


def execute_action(action, payload, workspace_root):
    if action == "ping":
        return success("Blender live bridge is ready", scene_summary())
    if action == "get_scene_state":
        return success("Scene state collected", scene_summary())
    if action == "select_objects":
        result = select_objects(payload)
        result.update(scene_summary())
        return success("Objects selected", result)
    if action == "viewport_preview":
        result = viewport_preview(payload, workspace_root)
        return success("Viewport preview generated", result)
    if action == "new_project":
        clear_scene()
        get_scene().name = payload.get("scene_name", "Scene")
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("New Blender project initialized", {"scene_name": get_scene().name, "save_path": saved_path, **scene_summary()})
    if action == "open_project":
        open_project_if_requested(payload, workspace_root)
        return success("Blender project opened", {"project_path": str(resolve_path(payload["project_path"], workspace_root)), **scene_summary()})
    if action == "save_project":
        open_project_if_requested(payload, workspace_root)
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Blender project saved", {"save_path": saved_path, **scene_summary()})
    if action == "reset_scene":
        clear_scene()
        get_scene().name = payload.get("scene_name", "Scene")
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Scene reset completed", {"save_path": saved_path, **scene_summary()})
    if action == "create_object":
        created = create_object(payload["object"])
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Object created", {"object_name": created.name, "object_type": payload["object"]["type"], "save_path": saved_path, **scene_summary()})
    if action == "modify_object":
        result = modify_object(payload["operation_data"])
        saved_path = save_project_if_requested(payload, workspace_root)
        result["save_path"] = saved_path
        result.update(scene_summary())
        return success("Object modification completed", result)
    if action == "assign_material":
        obj = find_object(payload["object_name"])
        material = ensure_material(payload["material"], f"{payload['object_name']}_material")
        assign_material(obj, material)
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Material assigned", {"object_name": obj.name, "material_name": material.name, "save_path": saved_path})
    if action == "create_light":
        light = create_light(payload["light"])
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Light created", {"light_name": light.name, "light_type": payload["light"]["type"], "save_path": saved_path})
    if action == "create_camera":
        camera = create_camera(payload["camera"])
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Camera created", {"camera_name": camera.name, "save_path": saved_path, **scene_summary()})
    if action == "render_still":
        output_path = configure_render(payload["render"], workspace_root)
        if output_path is None:
            raise RuntimeError("render.output_path is required for render_still")
        bpy.ops.render.render(write_still=True)
        saved_path = save_project_if_requested(payload, workspace_root)
        return success("Render completed", {"output_path": str(output_path), "save_path": saved_path})
    if action == "import_asset":
        result = import_asset(payload, workspace_root)
        saved_path = save_project_if_requested(payload, workspace_root)
        result["save_path"] = saved_path
        return success("Asset imported", result)
    if action == "export_asset":
        result = export_asset(payload, workspace_root)
        return success("Asset exported", result)
    if action == "build_scene":
        result = build_scene(payload, workspace_root)
        saved_path = save_project_if_requested(payload, workspace_root)
        result["save_path"] = saved_path
        result.update(scene_summary())
        return success("Scene build completed", result)
    return failure(f"Unsupported action '{action}'", code="BLENDER_UNSUPPORTED_ACTION")
