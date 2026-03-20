// Copyright (c) 2026 Flavio Cerato
﻿import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';

const execFile = promisify(execFileCb);
const WORKSPACE_BASE = path.resolve(process.env.WORKSPACE_DIR ?? path.join(process.cwd(), 'workspace'));

function resolveAndValidatePath(inputPath: string): string {
    const trimmed = String(inputPath ?? '').trim();
    if (!trimmed) {
        throw new Error('filePath is required');
    }

    const resolved = path.resolve(WORKSPACE_BASE, trimmed);
    const normalizedBase = WORKSPACE_BASE.endsWith(path.sep) ? WORKSPACE_BASE : `${WORKSPACE_BASE}${path.sep}`;

    if (resolved !== WORKSPACE_BASE && !resolved.startsWith(normalizedBase)) {
        throw new Error('filePath not allowed: must be inside the workspace');
    }

    return resolved;
}

async function runLinuxPrint(filePath: string, copies: number, printer?: string) {
    const args = ['-n', String(copies)];
    if (printer) args.push('-d', printer);
    args.push(filePath);

    try {
        const out = await execFile('lp', args);
        return { command: 'lp', stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
    } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
        const lprArgs: string[] = [];
        if (printer) lprArgs.push('-P', printer);
        if (copies > 1) lprArgs.push('-#', String(copies));
        lprArgs.push(filePath);
        const out = await execFile('lpr', lprArgs);
        return { command: 'lpr', stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
    }
}

async function runWindowsPrint(filePath: string, copies: number) {
    const script = "param([string]$p) Start-Process -FilePath $p -Verb Print | Out-Null";
    for (let i = 0; i < copies; i += 1) {
        await execFile('powershell', ['-NoProfile', '-Command', script, filePath]);
    }
    return { command: 'powershell Start-Process -Verb Print', stdout: '', stderr: '' };
}

async function getConfiguredDefaultPrinter(): Promise<string | undefined> {
    try {
        const res = await query("SELECT ciphertext FROM secrets WHERE key='printer.default_name'");
        if (!res.rows.length) return undefined;
        const val = JSON.parse(decrypt(res.rows[0].ciphertext as string));
        const name = String(val ?? '').trim();
        return name || undefined;
    } catch {
        return undefined;
    }
}

toolRegistry.register({
    name: 'print.default',
    description: 'Send a file to the operating system default printer',
    inputSchema: {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: "File path relative to the workspace (e.g. 'storage/output/report.pdf')" },
            copies: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of copies (default 1)' },
            printer: { type: 'string', description: 'Printer name (Linux/CUPS only; optional)' }
        },
        required: ['filePath']
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const copies = Number.isFinite(input?.copies) ? Math.min(Math.max(Number(input.copies), 1), 20) : 1;
        const printerFromInput = typeof input?.printer === 'string' && input.printer.trim() ? input.printer.trim() : undefined;
        const configuredPrinter = await getConfiguredDefaultPrinter();
        const printer = printerFromInput ?? configuredPrinter;
        const filePath = resolveAndValidatePath(input?.filePath);

        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
            throw new Error(`File not found: ${input?.filePath}`);
        }

        logger.info(`print.default requested for ${filePath} (copies=${copies}, platform=${process.platform}, printer=${printer ?? 'system-default'})`);

        const result = process.platform === 'win32'
            ? await runWindowsPrint(filePath, copies)
            : await runLinuxPrint(filePath, copies, printer);

        return {
            success: true,
            filePath,
            copies,
            printer: printer ?? 'system-default',
            platform: process.platform,
            command: result.command,
            stdout: result.stdout,
            stderr: result.stderr,
            message: `Print job sent: ${path.basename(filePath)} x${copies}`
        };
    }
});
