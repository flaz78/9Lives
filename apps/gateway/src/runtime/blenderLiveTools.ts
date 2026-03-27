import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';

const BLENDER_LIVE_BASE_URL = process.env.BLENDER_LIVE_BASE_URL || 'http://127.0.0.1:8765';
const BLENDER_LIVE_TOKEN = process.env.BLENDER_LIVE_TOKEN || '';
const DEFAULT_TIMEOUT_MS = Number(process.env.BLENDER_LIVE_TIMEOUT_MS || 120000);

logger.info(`Loading Blender live tools for ${BLENDER_LIVE_BASE_URL}`);

const vec3Field = {
    type: 'array',
    items: { type: 'number' },
    minItems: 3,
    maxItems: 3,
};
const rgbaField = {
    type: 'array',
    items: { type: 'number' },
    minItems: 4,
    maxItems: 4,
};
const materialSchema = {
    type: 'object',
    properties: {
        base_color: rgbaField,
        metallic: { type: 'number' },
        roughness: { type: 'number' },
        transmission: { type: 'number' },
        emission_color: rgbaField,
        emission_strength: { type: 'number' },
        ior: { type: 'number' },
    },
};

async function blenderLiveRequest(pathname: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = new Headers(init.headers || {});
        if (BLENDER_LIVE_TOKEN) {
            headers.set('Authorization', `Bearer ${BLENDER_LIVE_TOKEN}`);
        }
        if (init.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(`${BLENDER_LIVE_BASE_URL}${pathname}`, {
            ...init,
            headers,
            signal: controller.signal,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
            return {
                success: false,
                message: parsed?.message || `Live bridge request failed with ${response.status}`,
                data: parsed?.data || {},
                error: parsed?.error || { code: 'BLENDER_LIVE_HTTP_ERROR', details: { status: response.status } },
            };
        }
        return parsed;
    } catch (error: any) {
        logger.error(`Blender live request failed for ${pathname}`, error);
        return {
            success: false,
            message: `Blender live request failed for ${pathname}`,
            data: {},
            error: {
                code: 'BLENDER_LIVE_GATEWAY_ERROR',
                details: {
                    baseUrl: BLENDER_LIVE_BASE_URL,
                    reason: error?.message || String(error),
                },
            },
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function executeLiveAction(action: string, payload: Record<string, unknown>) {
    return blenderLiveRequest('/execute', {
        method: 'POST',
        body: JSON.stringify({ action, payload }),
    }, Number(payload.timeout_ms || DEFAULT_TIMEOUT_MS));
}

toolRegistry.register({
    name: 'blender.liveStatus',
    description: 'Checks the status of a running Blender live bridge addon.',
    inputSchema: { type: 'object', properties: {} },
    sideEffecting: false,
    handler: async () => executeLiveAction('ping', {}),
});

toolRegistry.register({
    name: 'blender.liveSceneState',
    description: 'Returns the current scene state from the live Blender session.',
    inputSchema: { type: 'object', properties: {} },
    sideEffecting: false,
    handler: async () => executeLiveAction('get_scene_state', {}),
});

toolRegistry.register({
    name: 'blender.liveExecute',
    description: 'Executes a whitelisted realtime Blender action on the connected live session.',
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string' },
            payload: { type: 'object' },
            timeout_ms: { type: 'number' },
        },
        required: ['action'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction(String(input.action), (input.payload as Record<string, unknown>) || {}),
});

toolRegistry.register({
    name: 'blender.liveBuildScene',
    description: 'Builds a scene in a running Blender GUI session from structured JSON.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            scene_name: { type: 'string' },
            reset_first: { type: 'boolean' },
            objects: { type: 'array', items: { type: 'object' } },
            lights: { type: 'array', items: { type: 'object' } },
            camera: { type: 'object', additionalProperties: true },
            render: { type: 'object', additionalProperties: true },
        },
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('build_scene', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveCreateObject',
    description: 'Creates a cube, sphere, cylinder, plane, cone, torus, or text object in the running Blender live session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            object: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['cube', 'sphere', 'cylinder', 'plane', 'cone', 'torus', 'text'] },
                    name: { type: 'string' },
                    text: { type: 'string' },
                    location: vec3Field,
                    rotation: vec3Field,
                    scale: vec3Field,
                    dimensions: vec3Field,
                    material: materialSchema,
                },
                required: ['type', 'name'],
            },
        },
        required: ['object'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('create_object', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveModifyObject',
    description: 'Moves, rotates, scales, duplicates, renames, parents, or deletes an object in the live Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            operation_data: {
                type: 'object',
                properties: {
                    target_name: { type: 'string' },
                    operation: { type: 'string', enum: ['move', 'rotate', 'scale', 'delete', 'duplicate', 'rename', 'set_origin', 'parent'] },
                    location: vec3Field,
                    rotation: vec3Field,
                    scale: vec3Field,
                    new_name: { type: 'string' },
                    parent_name: { type: 'string' },
                    origin_mode: { type: 'string' },
                },
                required: ['target_name', 'operation'],
            },
        },
        required: ['operation_data'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('modify_object', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveAssignMaterial',
    description: 'Assigns a basic Principled BSDF material to an object in the live Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            object_name: { type: 'string' },
            material: materialSchema,
        },
        required: ['object_name', 'material'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('assign_material', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveCreateLight',
    description: 'Creates a point, sun, area, or spot light in the live Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            light: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['point', 'sun', 'area', 'spot'] },
                    name: { type: 'string' },
                    location: vec3Field,
                    rotation: vec3Field,
                    color: rgbaField,
                    energy: { type: 'number' },
                },
                required: ['type', 'name'],
            },
        },
        required: ['light'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('create_light', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveCreateCamera',
    description: 'Creates or positions a camera in the live Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            camera: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    location: vec3Field,
                    rotation: vec3Field,
                    lens: { type: 'number' },
                    set_active: { type: 'boolean' },
                },
            },
        },
        required: ['camera'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('create_camera', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveRenderStill',
    description: 'Renders a still image from the live Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            render: {
                type: 'object',
                properties: {
                    engine: { type: 'string', enum: ['EEVEE', 'BLENDER_EEVEE', 'CYCLES'] },
                    resolution_x: { type: 'number' },
                    resolution_y: { type: 'number' },
                    samples: { type: 'number' },
                    transparent_background: { type: 'boolean' },
                    background_color: rgbaField,
                    output_path: { type: 'string' },
                },
                required: ['output_path'],
            },
        },
        required: ['render'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('render_still', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveImportAsset',
    description: 'Imports an OBJ or GLTF/GLB asset into the live Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            save_path: { type: 'string' },
            input_path: { type: 'string' },
            format: { type: 'string', enum: ['obj', 'glb', 'gltf'] },
        },
        required: ['input_path'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('import_asset', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveExportAsset',
    description: 'Exports the current live Blender scene to OBJ, GLB/GLTF, or FBX.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: { type: 'string' },
            output_path: { type: 'string' },
            format: { type: 'string', enum: ['obj', 'glb', 'gltf', 'fbx'] },
        },
        required: ['output_path'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('export_asset', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveSelectObjects',
    description: 'Selects objects in the current Blender live session.',
    inputSchema: {
        type: 'object',
        properties: {
            object_names: { type: 'array', items: { type: 'string' } },
        },
        required: ['object_names'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('select_objects', input as Record<string, unknown>),
});

toolRegistry.register({
    name: 'blender.liveViewportPreview',
    description: 'Captures a realtime viewport preview PNG from the running Blender session.',
    inputSchema: {
        type: 'object',
        properties: {
            output_path: { type: 'string' },
        },
        required: ['output_path'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => executeLiveAction('viewport_preview', input as Record<string, unknown>),
});
