// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../util/logger.js';
import { toolRegistry } from './toolRegistry.js';

logger.info('imageBase64Tools module loaded');

const STORAGE_BASE = process.env.FILESYSTEM_STORAGE_DIR ?? path.join(process.cwd(), 'workspace/storage');

function sanitizeSubDir(subDir: string) {
    return path.normalize(subDir).replace(/^(\.\.(\/|\\|$))+/, '');
}

function getMimeType(fileName: string) {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.bmp':
            return 'image/bmp';
        case '.svg':
            return 'image/svg+xml';
        default:
            return 'application/octet-stream';
    }
}

toolRegistry.register({
    name: 'image.toBase64',
    description: 'Read an image file from storage and convert it to base64',
    inputSchema: {
        type: 'object',
        properties: {
            subDir: { type: 'string', description: "Storage subfolder (e.g.: 'images' or 'output')" },
            fileName: { type: 'string', description: "Image file name (e.g.: 'photo.png')" },
            includeDataUri: {
                type: 'boolean',
                description: 'If true, also returns the data URI prefix',
                default: true
            }
        },
        required: ['subDir', 'fileName']
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const safeSubDir = sanitizeSubDir(input.subDir);
        const safeFileName = path.basename(input.fileName);
        const filePath = path.join(STORAGE_BASE, safeSubDir, safeFileName);
        const includeDataUri = input.includeDataUri !== false;

        try {
            const buffer = await fs.readFile(filePath);
            const mimeType = getMimeType(safeFileName);
            const base64 = buffer.toString('base64');

            logger.info(`Image converted to base64: ${filePath}`);

            return {
                success: true,
                path: filePath,
                mimeType,
                base64,
                dataUri: includeDataUri ? `data:${mimeType};base64,${base64}` : undefined
            };
        } catch (err: any) {
            logger.error(`Image to base64 error for ${filePath}`, err);
            throw new Error(`Error converting image to base64: ${err.message}`);
        }
    }
});

toolRegistry.register({
    name: 'image.fromBase64',
    description: 'Create an image file in storage from a base64 string or data URI',
    inputSchema: {
        type: 'object',
        properties: {
            base64: { type: 'string', description: 'Pure base64 string or complete data URI' },
            subDir: { type: 'string', description: "Storage subfolder where the image will be saved" },
            fileName: { type: 'string', description: "Output file name (e.g.: 'restored.png')" }
        },
        required: ['base64', 'subDir', 'fileName']
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const safeSubDir = sanitizeSubDir(input.subDir);
        const safeFileName = path.basename(input.fileName);
        const dirPath = path.join(STORAGE_BASE, safeSubDir);
        const filePath = path.join(dirPath, safeFileName);

        const rawValue = String(input.base64).trim();
        const cleanedBase64 = rawValue.includes(',')
            ? rawValue.slice(rawValue.indexOf(',') + 1).trim()
            : rawValue;

        try {
            const buffer = Buffer.from(cleanedBase64, 'base64');
            if (!buffer.length) {
                throw new Error('Empty or invalid base64 string');
            }

            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, buffer);

            logger.info(`Image created from base64: ${filePath}`);

            return {
                success: true,
                path: filePath,
                size: buffer.length,
                message: `Image saved successfully to ${safeSubDir}/${safeFileName}`
            };
        } catch (err: any) {
            logger.error(`Image from base64 error for ${filePath}`, err);
            throw new Error(`Error creating image from base64: ${err.message}`);
        }
    }
});
