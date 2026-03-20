// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';

logger.info('fsTools module loaded');

const STORAGE_BASE = process.env.FILESYSTEM_STORAGE_DIR ?? path.join(process.cwd(), 'workspace/storage');

logger.info('Loading filesystem tools...');

toolRegistry.register({
    name: 'filesystem.saveFile',
    description: 'Saves content to a file in a specific subfolder',
    inputSchema: {
        type: 'object',
        properties: {
            subDir: { type: 'string', description: "Subfolder (e.g.: 'output' or 'logs')" },
            fileName: { type: 'string', description: "File name (e.g.: 'report.txt')" },
            content: { type: 'string', description: "Text content to save" }
        },
        required: ['subDir', 'fileName', 'content']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const { subDir, fileName, content } = input;

        // Prevent path traversal
        const safeSubDir = path.normalize(subDir).replace(/^(\.\.(\/|\\|$))+/, '');
        const safeFileName = path.basename(fileName);

        const dirPath = path.join(STORAGE_BASE, safeSubDir);
        const filePath = path.join(dirPath, safeFileName);

        try {
            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, content, 'utf8');
            logger.info(`Filesystem: saved file ${filePath}`);
            return {
                success: true,
                path: filePath,
                message: `File saved successfully to ${safeSubDir}/${safeFileName}`
            };
        } catch (err: any) {
            logger.error(`Filesystem error saving file ${filePath}`, err);
            throw new Error(`Error saving file: ${err.message}`);
        }
    }
});

toolRegistry.register({
    name: 'filesystem.list',
    description: 'Lists files and folders in a specific subfolder of the storage',
    inputSchema: {
        type: 'object',
        properties: {
            subDir: { type: 'string', description: "Subfolder to list (e.g.: 'output', 'logs' or '.' for root)", default: "." }
        }
    },
    sideEffecting: false,
    handler: async (ctx, input) => {
        const { subDir = '.' } = input;

        // Prevent path traversal
        const safeSubDir = path.normalize(subDir).replace(/^(\.\.(\/|\\|$))+/, '');
        const targetDir = path.join(STORAGE_BASE, safeSubDir);

        try {
            // Ensure base storage exists
            await fs.mkdir(STORAGE_BASE, { recursive: true });

            try {
                const entries = await fs.readdir(targetDir, { withFileTypes: true });
                const items = entries.map(entry => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    path: path.join(safeSubDir, entry.name)
                }));

                return {
                    subDir: safeSubDir,
                    items
                };
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return { message: `The folder '${safeSubDir}' does not exist yet in storage.`, items: [] };
                }
                throw err;
            }
        } catch (err: any) {
            logger.error(`Filesystem error listing directory ${targetDir}`, err);
            throw new Error(`Error reading folder: ${err.message}`);
        }
    }
});

toolRegistry.register({
    name: 'filesystem.renameFile',
    description: 'Renames or moves an existing file within the storage',
    inputSchema: {
        type: 'object',
        properties: {
            subDir: { type: 'string', description: "Subfolder where the file is located (e.g.: 'output')" },
            oldName: { type: 'string', description: "Current file name" },
            newName: { type: 'string', description: "New file name" }
        },
        required: ['subDir', 'oldName', 'newName']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const { subDir, oldName, newName } = input;

        const safeSubDir = path.normalize(subDir).replace(/^(\.\.(\/|\\|$))+/, '');
        const safeOldName = path.basename(oldName);
        const safeNewName = path.basename(newName);

        const oldPath = path.join(STORAGE_BASE, safeSubDir, safeOldName);
        const newPath = path.join(STORAGE_BASE, safeSubDir, safeNewName);

        try {
            await fs.rename(oldPath, newPath);
            logger.info(`Filesystem: renamed ${oldPath} to ${newPath}`);
            return {
                success: true,
                path: newPath,
                message: `File renamed from ${safeOldName} to ${safeNewName} in folder ${safeSubDir}`
            };
        } catch (err: any) {
            logger.error(`Filesystem error renaming file ${oldPath}`, err);
            throw new Error(`Error renaming file: ${err.message}`);
        }
    }
});

toolRegistry.register({
    name: 'filesystem.deleteFile',
    description: 'Deletes an existing file from storage',
    inputSchema: {
        type: 'object',
        properties: {
            subDir: { type: 'string', description: "Subfolder where the file is located" },
            fileName: { type: 'string', description: "Name of the file to delete" }
        },
        required: ['subDir', 'fileName']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const { subDir, fileName } = input;

        const safeSubDir = path.normalize(subDir).replace(/^(\.\.(\/|\\|$))+/, '');
        const safeFileName = path.basename(fileName);

        const filePath = path.join(STORAGE_BASE, safeSubDir, safeFileName);

        try {
            await fs.unlink(filePath);
            logger.info(`Filesystem: deleted file ${filePath}`);
            return {
                success: true,
                message: `File ${safeFileName} successfully deleted from folder ${safeSubDir}`
            };
        } catch (err: any) {
            logger.error(`Filesystem error deleting file ${filePath}`, err);
            throw new Error(`Error deleting file: ${err.message}`);
        }
    }
});
