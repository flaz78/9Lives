// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { getDriveAccessToken } from './googleDriveAuth.js';
import fs from 'node:fs';
import path from 'node:path';

logger.info('googleDriveTools module loaded');

// ── MIME type helpers ──────────────────────────────────────────────────────

const GOOGLE_MIME_EXPORT: Record<string, string> = {
    'application/vnd.google-apps.document':     'text/plain',
    'application/vnd.google-apps.spreadsheet':  'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing':      'image/png',
};

function guessMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
        json: 'application/json', xml: 'application/xml',
        html: 'text/html', htm: 'text/html',
        pdf: 'application/pdf',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
        mp4: 'video/mp4', mp3: 'audio/mpeg',
        zip: 'application/zip', gz: 'application/gzip',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    return map[ext] ?? 'application/octet-stream';
}

// ── Drive API helpers ──────────────────────────────────────────────────────

async function driveGet(endpoint: string, params?: Record<string, string>): Promise<any> {
    const token = await getDriveAccessToken();
    const url   = new URL(`https://www.googleapis.com/drive/v3${endpoint}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
    return res.json();
}

async function driveGetBinary(endpoint: string, params?: Record<string, string>): Promise<Buffer> {
    const token = await getDriveAccessToken();
    const url   = new URL(`https://www.googleapis.com/drive/v3${endpoint}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
}

async function drivePost(endpoint: string, body: object): Promise<any> {
    const token = await getDriveAccessToken();
    const res   = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
    return res.json();
}

async function drivePatch(endpoint: string, body: object): Promise<any> {
    const token = await getDriveAccessToken();
    const res   = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
        method:  'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
    return res.json();
}

async function driveDelete(endpoint: string): Promise<void> {
    const token = await getDriveAccessToken();
    const res   = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
        method:  'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
}

async function driveUploadMultipart(metadata: object, content: Buffer, mimeType: string, fileId?: string): Promise<any> {
    const token    = await getDriveAccessToken();
    const boundary = `boundary_${Date.now()}`;
    const metaJson = JSON.stringify(metadata);

    const bodyParts = [
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${boundary}--`),
    ];
    const body = Buffer.concat(bodyParts);

    const isUpdate = !!fileId;
    const url      = isUpdate
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,modifiedTime`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,modifiedTime`;

    const res = await fetch(url, {
        method:  isUpdate ? 'PATCH' : 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  `multipart/related; boundary=${boundary}`,
        },
        body,
    });
    if (!res.ok) throw new Error(`Drive upload ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Tool: gdrive.listFiles ────────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.listFiles',
    description: "List files and folders in Google Drive (default: root folder). Use folderId='root' for the root.",
    inputSchema: {
        type: 'object',
        properties: {
            folderId:  { type: 'string',  description: "Folder ID (default: 'root' = root folder)", default: 'root' },
            pageSize:  { type: 'number',  description: 'Maximum number of files to return (default: 20, max: 100)', default: 20 },
            orderBy:   { type: 'string',  description: "Sort order: 'name', 'modifiedTime', 'createdTime' (default: 'name')", default: 'name' },
            trashed:   { type: 'boolean', description: 'If true, show files in trash (default: false)', default: false },
        },
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { folderId = 'root', pageSize = 20, orderBy = 'name', trashed = false } = input;
        logger.info(`Drive: listFiles folderId="${folderId}"`);

        const q = `'${folderId}' in parents and trashed = ${trashed}`;
        const data = await driveGet('/files', {
            q,
            pageSize:  String(Math.min(pageSize, 100)),
            orderBy,
            fields:    'files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared)',
        });

        const files = (data.files ?? []).map((f: any) => ({
            id:           f.id,
            name:         f.name,
            mimeType:     f.mimeType,
            size:         f.size ? parseInt(f.size) : null,
            modifiedTime: f.modifiedTime,
            isFolder:     f.mimeType === 'application/vnd.google-apps.folder',
            isGoogleDoc:  f.mimeType?.startsWith('application/vnd.google-apps.'),
            webViewLink:  f.webViewLink,
            shared:       f.shared,
        }));

        return { count: files.length, folderId, files };
    },
});

// ── Tool: gdrive.getFile ──────────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.getFile',
    description: 'Retrieve metadata of a Google Drive file by its ID',
    inputSchema: {
        type: 'object',
        properties: {
            fileId: { type: 'string', description: "File ID (obtainable via listFiles or searchFiles)" },
        },
        required: ['fileId'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { fileId } = input;
        logger.info(`Drive: getFile id="${fileId}"`);

        const f = await driveGet(`/files/${fileId}`, {
            fields: 'id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,description,shared,owners',
        });

        return {
            id:           f.id,
            name:         f.name,
            mimeType:     f.mimeType,
            size:         f.size ? parseInt(f.size) : null,
            modifiedTime: f.modifiedTime,
            createdTime:  f.createdTime,
            isFolder:     f.mimeType === 'application/vnd.google-apps.folder',
            isGoogleDoc:  f.mimeType?.startsWith('application/vnd.google-apps.'),
            webViewLink:  f.webViewLink,
            description:  f.description,
            shared:       f.shared,
            owners:       (f.owners ?? []).map((o: any) => o.emailAddress),
        };
    },
});

// ── Tool: gdrive.readFile ─────────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.readFile',
    description: 'Read the text content of a Google Drive file. For Google Docs/Sheets/Slides, automatically exports as text/CSV. For binary files, returns base64.',
    inputSchema: {
        type: 'object',
        properties: {
            fileId:       { type: 'string', description: "ID of the file to read" },
            exportFormat: { type: 'string', description: "Export format for Google Docs (e.g.: 'text/plain', 'text/csv', 'application/pdf'). If omitted, detected automatically." },
            maxChars:     { type: 'number', description: "Maximum number of characters to return for text files (default: 10000)", default: 10000 },
        },
        required: ['fileId'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { fileId, exportFormat, maxChars = 10000 } = input;
        logger.info(`Drive: readFile id="${fileId}"`);

        // Get metadata first
        const meta = await driveGet(`/files/${fileId}`, { fields: 'id,name,mimeType,size' });
        const mime = meta.mimeType as string;

        // Google Workspace files need export
        const isGoogleApp = mime.startsWith('application/vnd.google-apps.');
        if (isGoogleApp && mime !== 'application/vnd.google-apps.folder') {
            const targetMime = exportFormat ?? GOOGLE_MIME_EXPORT[mime] ?? 'text/plain';
            const buf  = await driveGetBinary(`/files/${fileId}/export`, { mimeType: targetMime });
            const text = buf.toString('utf-8').substring(0, maxChars);
            return {
                id:       fileId,
                name:     meta.name,
                mimeType: mime,
                exported: targetMime,
                content:  text,
                truncated: buf.length > maxChars,
            };
        }

        // Regular files
        const size = parseInt(meta.size ?? '0');
        const MAX_TEXT_SIZE = 1024 * 1024; // 1 MB

        const isText = mime.startsWith('text/') || ['application/json', 'application/xml', 'text/markdown'].includes(mime);
        if (isText && size <= MAX_TEXT_SIZE) {
            const buf  = await driveGetBinary(`/files/${fileId}`, { alt: 'media' });
            const text = buf.toString('utf-8').substring(0, maxChars);
            return { id: fileId, name: meta.name, mimeType: mime, content: text, truncated: buf.length > maxChars };
        }

        // Binary or large files — return base64 (capped at 512 KB)
        const MAX_BINARY = 512 * 1024;
        if (size <= MAX_BINARY) {
            const buf = await driveGetBinary(`/files/${fileId}`, { alt: 'media' });
            return { id: fileId, name: meta.name, mimeType: mime, content: buf.toString('base64'), encoding: 'base64', size };
        }

        return { id: fileId, name: meta.name, mimeType: mime, size, message: `File too large for inline reading (${(size / 1024 / 1024).toFixed(1)} MB). Use gdrive.downloadFile to save it to disk.` };
    },
});

// ── Tool: gdrive.downloadFile ─────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.downloadFile',
    description: 'Download a file from Google Drive and save it to the server filesystem',
    inputSchema: {
        type: 'object',
        properties: {
            fileId:       { type: 'string', description: "ID of the file to download" },
            savePath:     { type: 'string', description: "Path where the file will be saved (e.g.: /app/workspace/document.pdf)" },
            exportFormat: { type: 'string', description: "Format for Google Docs (e.g.: 'application/pdf', 'text/plain'). Ignored for regular files." },
        },
        required: ['fileId', 'savePath'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { fileId, savePath, exportFormat } = input;
        logger.info(`Drive: downloadFile id="${fileId}" → "${savePath}"`);

        const meta     = await driveGet(`/files/${fileId}`, { fields: 'id,name,mimeType,size' });
        const mime     = meta.mimeType as string;
        const isGoogle = mime.startsWith('application/vnd.google-apps.');

        let buf: Buffer;
        if (isGoogle) {
            const targetMime = exportFormat ?? GOOGLE_MIME_EXPORT[mime] ?? 'application/pdf';
            buf = await driveGetBinary(`/files/${fileId}/export`, { mimeType: targetMime });
        } else {
            buf = await driveGetBinary(`/files/${fileId}`, { alt: 'media' });
        }

        const resolved = path.resolve(savePath);
        const dir      = path.dirname(resolved);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolved, buf);

        return { success: true, savedTo: resolved, name: meta.name, mimeType: mime, size: buf.length };
    },
});

// ── Tool: gdrive.searchFiles ──────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.searchFiles',
    description: "Search files in Google Drive. Supports Drive queries (e.g.: \"name contains 'report'\", \"mimeType='application/pdf'\", \"modifiedTime > '2024-01-01'\")",
    inputSchema: {
        type: 'object',
        properties: {
            query:     { type: 'string', description: "Drive query (e.g.: \"name contains 'invoice'\" or \"'folder_id' in parents\")" },
            maxResults: { type: 'number', description: 'Maximum number of results (default: 20)', default: 20 },
            trashed:    { type: 'boolean', description: 'Include files in trash (default: false)', default: false },
        },
        required: ['query'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { query: q, maxResults = 20, trashed = false } = input;
        logger.info(`Drive: searchFiles query="${q}"`);

        const fullQuery = trashed ? q : `(${q}) and trashed = false`;
        const data = await driveGet('/files', {
            q:        fullQuery,
            pageSize: String(Math.min(maxResults, 100)),
            fields:   'files(id,name,mimeType,size,modifiedTime,parents,webViewLink)',
        });

        const files = (data.files ?? []).map((f: any) => ({
            id:           f.id,
            name:         f.name,
            mimeType:     f.mimeType,
            size:         f.size ? parseInt(f.size) : null,
            modifiedTime: f.modifiedTime,
            isFolder:     f.mimeType === 'application/vnd.google-apps.folder',
            webViewLink:  f.webViewLink,
        }));

        return { count: files.length, query: q, files };
    },
});

// ── Tool: gdrive.createFolder ─────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.createFolder',
    description: 'Create a new folder in Google Drive',
    inputSchema: {
        type: 'object',
        properties: {
            name:     { type: 'string', description: "Folder name" },
            parentId: { type: 'string', description: "Parent folder ID (default: root)", default: 'root' },
        },
        required: ['name'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { name, parentId = 'root' } = input;
        logger.info(`Drive: createFolder name="${name}" parent="${parentId}"`);

        const f = await drivePost('/files?fields=id,name,mimeType,webViewLink', {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents:  [parentId],
        });

        return { id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink };
    },
});

// ── Tool: gdrive.uploadFile ───────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.uploadFile',
    description: 'Upload a file to Google Drive. Content can come from a local path (path) or from base64 (content)',
    inputSchema: {
        type: 'object',
        properties: {
            name:        { type: 'string', description: "File name on Drive (e.g.: 'report.pdf')" },
            folderId:    { type: 'string', description: "Destination folder ID (default: root)", default: 'root' },
            path:        { type: 'string', description: "Absolute path of the local file to upload (alternative to content)" },
            content:     { type: 'string', description: "File content in base64 (alternative to path)" },
            mimeType:    { type: 'string', description: "MIME type (e.g.: 'application/pdf'). Detected automatically if omitted." },
        },
        required: ['name'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { name, folderId = 'root', path: filePath, content, mimeType } = input;
        logger.info(`Drive: uploadFile name="${name}" folder="${folderId}"`);

        let buf: Buffer;
        if (filePath) {
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
            buf = fs.readFileSync(resolved);
        } else if (content) {
            buf = Buffer.from(content, 'base64');
        } else {
            throw new Error('Specify either "path" (file path) or "content" (base64).');
        }

        const mime = mimeType ?? guessMimeType(name);
        const f    = await driveUploadMultipart({ name, parents: [folderId] }, buf, mime);

        return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? parseInt(f.size) : buf.length, webViewLink: f.webViewLink };
    },
});

// ── Tool: gdrive.updateFile ───────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.updateFile',
    description: 'Update the content and/or name of an existing file on Google Drive',
    inputSchema: {
        type: 'object',
        properties: {
            fileId:   { type: 'string', description: "ID of the file to update" },
            name:     { type: 'string', description: "New file name (optional)" },
            path:     { type: 'string', description: "Path of the local file with the new content" },
            content:  { type: 'string', description: "New content in base64 (alternative to path)" },
            mimeType: { type: 'string', description: "MIME type of the new content (optional)" },
        },
        required: ['fileId'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { fileId, name, path: filePath, content, mimeType } = input;
        logger.info(`Drive: updateFile id="${fileId}"`);

        // If only renaming (no content change)
        if (!filePath && !content) {
            if (!name) throw new Error('Specify at least "name" (rename) or "path"/"content" (update content).');
            const f = await drivePatch(`/files/${fileId}?fields=id,name,modifiedTime`, { name });
            return { id: f.id, name: f.name, modifiedTime: f.modifiedTime };
        }

        let buf: Buffer;
        if (filePath) {
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
            buf = fs.readFileSync(resolved);
        } else {
            buf = Buffer.from(content!, 'base64');
        }

        const meta = await driveGet(`/files/${fileId}`, { fields: 'name,mimeType' });
        const mime = mimeType ?? meta.mimeType ?? 'application/octet-stream';
        const metadata: any = {};
        if (name) metadata.name = name;

        const f = await driveUploadMultipart(metadata, buf, mime, fileId);
        return { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: f.webViewLink };
    },
});

// ── Tool: gdrive.deleteFile ───────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.deleteFile',
    description: 'Move a file to Google Drive trash (or permanently delete it)',
    inputSchema: {
        type: 'object',
        properties: {
            fileId:      { type: 'string',  description: "ID of the file to delete" },
            permanently: { type: 'boolean', description: "If true, permanently delete without moving to trash (default: false)", default: false },
        },
        required: ['fileId'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { fileId, permanently = false } = input;
        logger.info(`Drive: deleteFile id="${fileId}" permanently=${permanently}`);

        if (permanently) {
            await driveDelete(`/files/${fileId}`);
        } else {
            await drivePatch(`/files/${fileId}`, { trashed: true });
        }

        return { success: true, fileId, permanently, message: permanently ? 'File permanently deleted.' : 'File moved to trash.' };
    },
});

// ── Tool: gdrive.moveFile ─────────────────────────────────────────────────

toolRegistry.register({
    name:        'gdrive.moveFile',
    description: 'Move a file to a different folder on Google Drive',
    inputSchema: {
        type: 'object',
        properties: {
            fileId:         { type: 'string', description: "ID of the file to move" },
            targetFolderId: { type: 'string', description: "ID of the destination folder" },
        },
        required: ['fileId', 'targetFolderId'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { fileId, targetFolderId } = input;
        logger.info(`Drive: moveFile id="${fileId}" → folder="${targetFolderId}"`);

        // Get current parents to remove them
        const meta = await driveGet(`/files/${fileId}`, { fields: 'parents,name' });
        const oldParents = (meta.parents ?? []).join(',');

        const token = await getDriveAccessToken();
        const url   = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents`);
        url.searchParams.set('addParents',    targetFolderId);
        if (oldParents) url.searchParams.set('removeParents', oldParents);

        const res = await fetch(url.toString(), {
            method:  'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
        const f = await res.json() as any;

        return { success: true, id: f.id, name: f.name, newParent: targetFolderId };
    },
});
