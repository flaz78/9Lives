import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { execFile as execFileCb } from 'node:child_process';
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import fsSync from 'fs';

const execFile = promisify(execFileCb);

const REMOTION_PROJECT_DIR_CANDIDATES = [
    process.env.REMOTION_PROJECT_DIR,
    path.join(process.cwd(), 'workspace', 'remotion'),
    path.join(process.cwd(), 'remotion'),
    '/app/remotion',
    '/app/workspace/remotion',
].filter((value): value is string => Boolean(value));
const REMOTION_ENTRY = process.env.REMOTION_ENTRY_FILE ?? 'src/index.ts';
const REMOTION_RENDER_DIR = 'renders';
const PROJECT_FILE_LIMIT = 200;

function resolveRemotionProjectDir() {
    for (const candidate of REMOTION_PROJECT_DIR_CANDIDATES) {
        const packageJson = path.join(candidate, 'package.json');
        const entryFile = path.join(candidate, REMOTION_ENTRY);
        if (fsSync.existsSync(packageJson) && fsSync.existsSync(entryFile)) {
            return candidate;
        }
    }

    return REMOTION_PROJECT_DIR_CANDIDATES[0] ?? '/app/remotion';
}

const REMOTION_PROJECT_DIR = resolveRemotionProjectDir();
const REMOTION_CLI = path.join(REMOTION_PROJECT_DIR, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

logger.info(`Loading Remotion tools from ${REMOTION_PROJECT_DIR}`);

function normalizeProjectPath(relativePath: string) {
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (!normalized || normalized === '.' || path.isAbsolute(normalized)) {
        throw new Error(`Invalid project path: ${relativePath}`);
    }

    const lower = normalized.toLowerCase();
    if (
        lower.startsWith(`node_modules${path.sep}`) ||
        lower.startsWith(`.git${path.sep}`) ||
        lower === 'node_modules' ||
        lower === '.git'
    ) {
        throw new Error(`Path not allowed inside Remotion project: ${relativePath}`);
    }

    return normalized;
}

async function ensureProjectReady() {
    try {
        await fs.access(REMOTION_PROJECT_DIR);
        await fs.access(path.join(REMOTION_PROJECT_DIR, 'package.json'));
        await fs.access(path.join(REMOTION_PROJECT_DIR, REMOTION_ENTRY));
        await fs.access(REMOTION_CLI);
    } catch (error: any) {
        const candidates = REMOTION_PROJECT_DIR_CANDIDATES.join(', ');
        throw new Error(
            `Remotion project not available at '${REMOTION_PROJECT_DIR}'. ` +
            `Set REMOTION_PROJECT_DIR or mount the project into the gateway container. ` +
            `Checked: ${candidates}. Original error: ${error.message}`
        );
    }
}

async function walkFiles(dir: string, baseDir = dir, acc: string[] = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (acc.length >= PROJECT_FILE_LIMIT) {
            break;
        }

        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
            continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walkFiles(fullPath, baseDir, acc);
            continue;
        }

        acc.push(path.relative(baseDir, fullPath));
    }

    return acc;
}

async function readProjectFile(relativePath: string) {
    try {
        return await fs.readFile(path.join(REMOTION_PROJECT_DIR, relativePath), 'utf8');
    } catch {
        return null;
    }
}

toolRegistry.register({
    name: 'remotion.getProjectState',
    description: 'Returns the current Remotion project structure, key source files and render output folder.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    sideEffecting: false,
    handler: async () => {
        await ensureProjectReady();

        const [packageJson, rootTsx, indexTs, compositionTsx, files] = await Promise.all([
            readProjectFile('package.json'),
            readProjectFile('src/Root.tsx'),
            readProjectFile('src/index.ts'),
            readProjectFile('src/Composition.tsx'),
            walkFiles(REMOTION_PROJECT_DIR),
        ]);

        return {
            projectDir: REMOTION_PROJECT_DIR,
            entryFile: REMOTION_ENTRY,
            renderDir: path.join(REMOTION_PROJECT_DIR, REMOTION_RENDER_DIR),
            files,
            keyFiles: {
                'package.json': packageJson,
                'src/index.ts': indexTs,
                'src/Root.tsx': rootTsx,
                'src/Composition.tsx': compositionTsx,
            },
        };
    },
});

toolRegistry.register({
    name: 'remotion.saveFiles',
    description: 'Creates or updates one or more files inside the configured Remotion project.',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Relative path inside the Remotion project, for example src/PromoVideo.tsx' },
                        content: { type: 'string', description: 'UTF-8 file contents' },
                    },
                    required: ['path', 'content'],
                },
                minItems: 1,
            },
        },
        required: ['files'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        await ensureProjectReady();

        const written: string[] = [];
        for (const file of input.files as Array<{ path: string; content: string }>) {
            const safeRelativePath = normalizeProjectPath(file.path);
            const fullPath = path.join(REMOTION_PROJECT_DIR, safeRelativePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, file.content, 'utf8');
            written.push(fullPath);
        }

        logger.info(`Remotion: wrote ${written.length} project files`);
        return {
            success: true,
            projectDir: REMOTION_PROJECT_DIR,
            written,
        };
    },
});

toolRegistry.register({
    name: 'remotion.listCompositions',
    description: 'Lists available Remotion compositions by invoking the local CLI on the configured project.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    sideEffecting: false,
    handler: async () => {
        await ensureProjectReady();

        const result = await execFile('node', [REMOTION_CLI, 'compositions', REMOTION_ENTRY], {
            cwd: REMOTION_PROJECT_DIR,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 10,
        });

        return {
            projectDir: REMOTION_PROJECT_DIR,
            stdout: result.stdout.trim(),
            stderr: result.stderr.trim(),
        };
    },
});

toolRegistry.register({
    name: 'remotion.renderVideo',
    description: 'Renders a Remotion composition to a video file in the configured project.',
    inputSchema: {
        type: 'object',
        properties: {
            compositionId: { type: 'string', description: 'Composition ID to render, for example MyComp' },
            outputFile: { type: 'string', description: 'Relative output path inside the project, defaults to renders/<composition>-timestamp.mp4' },
            props: { type: 'object', description: 'Serializable props passed to the composition at render time' },
            codec: { type: 'string', description: 'Optional Remotion codec, for example h264, h265, vp8, prores' },
            imageFormat: { type: 'string', description: 'Optional image format, for example jpeg or png' },
            overwrite: { type: 'boolean', description: 'Overwrite existing output file', default: true },
        },
        required: ['compositionId'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        await ensureProjectReady();

        const compositionId = String(input.compositionId);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const requestedOutput = input.outputFile
            ? normalizeProjectPath(String(input.outputFile))
            : path.join(REMOTION_RENDER_DIR, `${compositionId}-${timestamp}.mp4`);
        const outputRelative = normalizeProjectPath(requestedOutput);
        const outputAbsolute = path.join(REMOTION_PROJECT_DIR, outputRelative);

        await fs.mkdir(path.dirname(outputAbsolute), { recursive: true });

        const args = ['--enable-source-maps', REMOTION_CLI, 'render', REMOTION_ENTRY, compositionId, outputAbsolute];

        if (input.codec) {
            args.push(`--codec=${String(input.codec)}`);
        }
        if (input.imageFormat) {
            args.push(`--image-format=${String(input.imageFormat)}`);
        }
        if (input.overwrite === false) {
            args.push('--overwrite=false');
        }
        if (input.props && typeof input.props === 'object') {
            args.push(`--props=${JSON.stringify(input.props)}`);
        }

        logger.info(`Remotion: rendering ${compositionId} to ${outputAbsolute}`);

        const result = await execFile('node', args, {
            cwd: REMOTION_PROJECT_DIR,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 20,
        });

        return {
            success: true,
            compositionId,
            outputPath: outputAbsolute,
            stdout: result.stdout.trim(),
            stderr: result.stderr.trim(),
        };
    },
});
