// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore — pdf-parse v2 exports named class PDFParse (no @types)
import { PDFParse } from 'pdf-parse';

logger.info('pdfTools module loaded');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? '/app/workspace';

function resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(WORKSPACE_DIR, filePath);
}

// ── Tool: pdf.readFile ────────────────────────────────────────────────────

toolRegistry.register({
    name: 'pdf.readFile',
    description: 'Reads the text content of a PDF file and returns it as plain text. Supports PDFs with selectable text (not scanned images).',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: "Path of the PDF file to read (e.g. /app/workspace/document.pdf or just 'document.pdf')",
            },
            pages: {
                type: 'string',
                description: "Page range to read (e.g. '1-5', '3', '2-10'). If omitted, reads the entire document.",
            },
            maxChars: {
                type: 'number',
                description: "Maximum number of characters to return (default: 20000)",
                default: 20000,
            },
        },
        required: ['path'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { path: filePath, pages, maxChars = 20000 } = input;
        logger.info(`PDF: readFile "${filePath}"${pages ? ` pages=${pages}` : ''}`);

        const resolved = resolveFilePath(filePath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);

        const buf = fs.readFileSync(resolved);

        // pdf-parse v2: class-based API
        const parser = new (PDFParse as any)({ data: new Uint8Array(buf) });

        // Parse page range if provided
        let pageFrom: number | undefined;
        let pageTo:   number | undefined;
        if (pages) {
            const match = pages.match(/^(\d+)(?:-(\d+))?$/);
            if (!match) throw new Error(`Invalid page format: "${pages}". Use '1', '1-5', etc.`);
            pageFrom = parseInt(match[1], 10);
            pageTo   = match[2] ? parseInt(match[2], 10) : pageFrom;
            if (pageFrom < 1) throw new Error('Page number must be >= 1.');
            if (pageTo < pageFrom) throw new Error('End page must be >= start page.');
        }

        // getText accepts { first, last } for page range filtering
        const textParams: any = {};
        if (pageFrom !== undefined) {
            textParams.first = pageFrom;
            textParams.last  = pageTo;
        }

        const result = await parser.getText(textParams);
        const totalPages = result.total as number;

        // Combine page texts
        let text = (result.pages as any[])
            .map((p: any) => p.text)
            .join('\n\n')
            .trim();

        const truncated = text.length > maxChars;
        if (truncated) text = text.slice(0, maxChars);

        const pagesRead = pageFrom !== undefined
            ? `${pageFrom}-${pageTo}`
            : `1-${totalPages}`;

        logger.info(`PDF: readFile done — ${totalPages} pages, ${text.length} chars`);

        await parser.destroy().catch(() => {});

        return {
            success: true,
            path: resolved,
            totalPages,
            pagesRead,
            chars: text.length,
            truncated,
            text,
        };
    },
});
