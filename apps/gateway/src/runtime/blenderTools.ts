import path from 'path';
import { promisify } from 'util';
import { execFile as execFileCb } from 'node:child_process';
import { toolRegistry, type ToolDefinition } from './toolRegistry.js';
import { logger } from '../util/logger.js';

const execFile = promisify(execFileCb);

const PYTHON_CANDIDATES = [
    process.env.PYTHON_EXECUTABLE,
    process.platform === 'win32' ? 'py' : undefined,
    'python3',
    'python',
].filter((value): value is string => Boolean(value));
const BLENDER_SKILL_SCRIPT = path.join(process.cwd(), 'workspace', 'skills', 'blender_skill', 'skill.py');
const DEFAULT_TIMEOUT_MS = Number(process.env.BLENDER_SKILL_TIMEOUT_MS || 10 * 60 * 1000);

logger.info(`Loading Blender tools from ${BLENDER_SKILL_SCRIPT}`);

async function execPythonScript(args: string[]) {
    let lastError: any = null;
    for (const executable of PYTHON_CANDIDATES) {
        try {
            const result = await execFile(executable, args, {
                cwd: process.cwd(),
                windowsHide: true,
                timeout: DEFAULT_TIMEOUT_MS,
                maxBuffer: 1024 * 1024 * 20,
            });
            return { executable, result };
        } catch (error: any) {
            lastError = error;
            if (error?.code !== 'ENOENT') {
                throw { executable, error };
            }
        }
    }

    throw {
        executable: PYTHON_CANDIDATES[0] || 'python',
        error: lastError || new Error('No Python executable found'),
        noPython: true,
    };
}

async function runBlenderAction(action: string, input: Record<string, unknown>) {
    const args = [
        BLENDER_SKILL_SCRIPT,
        '--action',
        action,
        '--payload-json',
        JSON.stringify(input || {}),
    ];

    if (process.env.BLENDER_EXECUTABLE) {
        args.push('--blender-executable', process.env.BLENDER_EXECUTABLE);
    }

    try {
        const { executable, result } = await execPythonScript(args);
        const parsed = JSON.parse((result.stdout || '').trim() || '{}');
        parsed.data = parsed.data || {};
        parsed.data.python_executable = executable;
        if (result.stderr?.trim()) {
            parsed.data.python_stderr = result.stderr.trim();
        }
        return parsed;
    } catch (wrapped: any) {
        const error = wrapped?.error || wrapped;
        const executable = wrapped?.executable || PYTHON_CANDIDATES[0] || 'python';
        const stdout = error?.stdout ? String(error.stdout).trim() : '';
        const stderr = error?.stderr ? String(error.stderr).trim() : '';

        if (stdout) {
            try {
                const parsed = JSON.parse(stdout);
                parsed.data = parsed.data || {};
                parsed.data.python_executable = executable;
                return parsed;
            } catch {
                // Fall through to structured gateway error.
            }
        }

        if (wrapped?.noPython) {
            return {
                success: false,
                message: 'Python runtime not available in the gateway container. Batch Blender tools require Python inside the container; use blender.live* tools for the local Blender bridge or install python3 and set PYTHON_EXECUTABLE.',
                data: {
                    stdout,
                    stderr,
                    attemptedExecutables: PYTHON_CANDIDATES,
                },
                error: {
                    code: 'BLENDER_PYTHON_NOT_FOUND',
                    details: {
                        action,
                        skillScript: BLENDER_SKILL_SCRIPT,
                    },
                },
            };
        }

        logger.error(`Blender tool '${action}' failed`, error);
        return {
            success: false,
            message: `Blender tool '${action}' failed`,
            data: {
                stdout,
                stderr,
                python_executable: executable,
            },
            error: {
                code: 'BLENDER_GATEWAY_EXEC_FAILED',
                details: {
                    action,
                    pythonExecutable: executable,
                    skillScript: BLENDER_SKILL_SCRIPT,
                    reason: error?.message || String(error),
                },
            },
        };
    }
}

function registerBlenderTool(definition: ToolDefinition) {
    toolRegistry.register(definition);
}

const pathField = { type: 'string', description: 'Relative path under BLENDER_SKILL_ROOT or an allowed absolute path' };
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

registerBlenderTool({
    name: 'blender.checkAvailability',
    description: 'Checks whether Blender is installed and the 9Lives Blender skill can invoke it.',
    inputSchema: { type: 'object', properties: {} },
    sideEffecting: false,
    handler: async () => runBlenderAction('check_availability', {}),
});

registerBlenderTool({
    name: 'blender.newProject',
    description: 'Creates a new Blender project and optionally saves it as a .blend file.',
    inputSchema: {
        type: 'object',
        properties: {
            scene_name: { type: 'string' },
            save_path: pathField,
        },
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('new_project', input),
});

registerBlenderTool({
    name: 'blender.openProject',
    description: 'Opens an existing .blend file and returns a scene summary.',
    inputSchema: {
        type: 'object',
        properties: { project_path: pathField },
        required: ['project_path'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => runBlenderAction('open_project', input),
});

registerBlenderTool({
    name: 'blender.saveProject',
    description: 'Loads an optional project and saves it to a .blend destination.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
        },
        required: ['save_path'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('save_project', input),
});

registerBlenderTool({
    name: 'blender.resetScene',
    description: 'Resets the scene by removing objects and unused data blocks.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            scene_name: { type: 'string' },
            save_path: pathField,
        },
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('reset_scene', input),
});

registerBlenderTool({
    name: 'blender.createObject',
    description: 'Creates a primitive object or text object with transforms and optional material.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
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
    handler: async (_ctx, input) => runBlenderAction('create_object', input),
});

registerBlenderTool({
    name: 'blender.modifyObject',
    description: 'Moves, rotates, scales, duplicates, renames, parents, or deletes an object.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
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
    handler: async (_ctx, input) => runBlenderAction('modify_object', input),
});

registerBlenderTool({
    name: 'blender.assignMaterial',
    description: 'Assigns a basic Principled BSDF material to an existing object.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
            object_name: { type: 'string' },
            material: materialSchema,
        },
        required: ['object_name', 'material'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('assign_material', input),
});

registerBlenderTool({
    name: 'blender.createLight',
    description: 'Creates a point, sun, area, or spot light.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
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
    handler: async (_ctx, input) => runBlenderAction('create_light', input),
});

registerBlenderTool({
    name: 'blender.createCamera',
    description: 'Creates a camera, positions it, and optionally marks it as active.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
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
    handler: async (_ctx, input) => runBlenderAction('create_camera', input),
});

registerBlenderTool({
    name: 'blender.renderStill',
    description: 'Renders a still image using EEVEE or CYCLES and returns the output path.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
            render: {
                type: 'object',
                properties: {
                    engine: { type: 'string', enum: ['EEVEE', 'BLENDER_EEVEE', 'CYCLES'] },
                    resolution_x: { type: 'number' },
                    resolution_y: { type: 'number' },
                    samples: { type: 'number' },
                    transparent_background: { type: 'boolean' },
                    background_color: rgbaField,
                    output_path: pathField,
                },
                required: ['output_path'],
            },
        },
        required: ['render'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('render_still', input),
});

registerBlenderTool({
    name: 'blender.importAsset',
    description: 'Imports an OBJ or GLTF/GLB asset into the current Blender scene.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
            input_path: pathField,
            format: { type: 'string', enum: ['obj', 'glb', 'gltf'] },
        },
        required: ['input_path'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('import_asset', input),
});

registerBlenderTool({
    name: 'blender.exportAsset',
    description: 'Exports the current Blender scene to OBJ, GLB/GLTF, or FBX.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            output_path: pathField,
            format: { type: 'string', enum: ['obj', 'glb', 'gltf', 'fbx'] },
        },
        required: ['output_path'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('export_asset', input),
});

registerBlenderTool({
    name: 'blender.buildScene',
    description: 'Builds a full scene from structured JSON, including objects, materials, lights, camera, render, and optional save.',
    inputSchema: {
        type: 'object',
        properties: {
            project_path: pathField,
            save_path: pathField,
            scene_name: { type: 'string' },
            reset_first: { type: 'boolean' },
            objects: { type: 'array', items: { type: 'object', additionalProperties: true } },
            lights: { type: 'array', items: { type: 'object', additionalProperties: true } },
            camera: { type: 'object', additionalProperties: true },
            render: { type: 'object', additionalProperties: true },
        },
    },
    sideEffecting: true,
    handler: async (_ctx, input) => runBlenderAction('build_scene', input),
});
