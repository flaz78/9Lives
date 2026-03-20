// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    AlignmentType, LevelFormat, convertInchesToTwip,
} from 'docx';
import fs from 'node:fs';
import path from 'node:path';

logger.info('wordTools module loaded');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? '/app/workspace';

/**
 * Resolves the file path:
 * - If absolute -> used as-is
 * - If relative -> resolved under WORKSPACE_DIR (e.g. "report.docx" -> "/app/workspace/report.docx")
 */
function resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(WORKSPACE_DIR, filePath);
}

// ── Block → docx element converters ──────────────────────────────────────

type Block =
    | { type: 'heading';    level: 1 | 2 | 3; text: string }
    | { type: 'paragraph';  text: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right' | 'justify' }
    | { type: 'table';      headers: string[]; rows: string[][] }
    | { type: 'list';       items: string[]; ordered?: boolean }
    | { type: 'pageBreak' };

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
};

const ALIGN_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
    left:    AlignmentType.LEFT,
    center:  AlignmentType.CENTER,
    right:   AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
};

function makeHeading(block: Extract<Block, { type: 'heading' }>): Paragraph {
    return new Paragraph({
        text:    block.text,
        heading: HEADING_MAP[block.level] ?? HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
    });
}

function makeParagraph(block: Extract<Block, { type: 'paragraph' }>): Paragraph {
    return new Paragraph({
        children: [new TextRun({
            text:   block.text,
            bold:   block.bold   ?? false,
            italics: block.italic ?? false,
        })],
        alignment: block.align ? ALIGN_MAP[block.align] : AlignmentType.LEFT,
        spacing: { after: 100 },
    });
}

function makeTable(block: Extract<Block, { type: 'table' }>): Table {
    const borderOpts = {
        style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC',
    };
    const allBorders = {
        top: borderOpts, bottom: borderOpts, left: borderOpts, right: borderOpts,
    };

    const headerCells = block.headers.map(h => new TableCell({
        children: [new Paragraph({
            children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })],
            alignment: AlignmentType.CENTER,
        })],
        shading: { fill: '4F46E5' },
        borders: allBorders,
    }));

    const dataRows = block.rows.map((row, rowIdx) =>
        new TableRow({
            children: row.map(cell => new TableCell({
                children: [new Paragraph({ text: cell, alignment: AlignmentType.LEFT })],
                shading: { fill: rowIdx % 2 === 0 ? 'F5F3FF' : 'FFFFFF' },
                borders: allBorders,
            })),
        })
    );

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: headerCells, tableHeader: true }), ...dataRows],
    });
}

function makeList(block: Extract<Block, { type: 'list' }>): Paragraph[] {
    return block.items.map((item, idx) => new Paragraph({
        text: item,
        numbering: block.ordered
            ? { reference: 'ordered-list',   level: 0 }
            : { reference: 'unordered-list', level: 0 },
    }));
}

function makePageBreak(): Paragraph {
    return new Paragraph({ pageBreakBefore: true });
}

// ── Tool: word.createFile ─────────────────────────────────────────────────

toolRegistry.register({
    name: 'word.createFile',
    description: 'Create a Word (.docx) file with title, paragraphs, headings, tables, and lists. Returns the path of the created file.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: "Absolute path where to save the file (e.g. /app/workspace/report.docx)",
            },
            title: {
                type: 'string',
                description: "Document title (optional)",
            },
            author: {
                type: 'string',
                description: "Document author (optional)",
            },
            content: {
                type: 'array',
                description: 'List of document content blocks',
                items: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['heading', 'paragraph', 'table', 'list', 'pageBreak'],
                            description: "Block type",
                        },
                        level: {
                            type: 'number',
                            enum: [1, 2, 3],
                            description: "Heading level (only for type='heading'): 1=H1, 2=H2, 3=H3",
                        },
                        text: {
                            type: 'string',
                            description: "Text (for type='heading' or 'paragraph')",
                        },
                        bold: {
                            type: 'boolean',
                            description: "Bold (only for type='paragraph')",
                        },
                        italic: {
                            type: 'boolean',
                            description: "Italic (only for type='paragraph')",
                        },
                        align: {
                            type: 'string',
                            enum: ['left', 'center', 'right', 'justify'],
                            description: "Text alignment (only for type='paragraph')",
                        },
                        headers: {
                            type: 'array',
                            items: { type: 'string' },
                            description: "Column headers (only for type='table')",
                        },
                        rows: {
                            type: 'array',
                            items: { type: 'array', items: { type: 'string' } },
                            description: "Data rows (only for type='table')",
                        },
                        items: {
                            type: 'array',
                            items: { type: 'string' },
                            description: "List items (only for type='list')",
                        },
                        ordered: {
                            type: 'boolean',
                            description: "Numbered list if true, bulleted if false (only for type='list')",
                        },
                    },
                    required: ['type'],
                },
            },
        },
        required: ['path', 'content'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { path: filePath, title, author, content } = input;
        logger.info(`Word: createFile "${filePath}" (${content.length} blocks)`);

        const resolved = resolveFilePath(filePath);
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Numbering config (passed inline to Document)
        const numberingConfig = {
            config: [
                {
                    reference: 'unordered-list',
                    levels: [{
                        level: 0,
                        format: LevelFormat.BULLET,
                        text: '\u2022',
                        alignment: AlignmentType.LEFT,
                        style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
                    }],
                },
                {
                    reference: 'ordered-list',
                    levels: [{
                        level: 0,
                        format: LevelFormat.DECIMAL,
                        text: '%1.',
                        alignment: AlignmentType.LEFT,
                        style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
                    }],
                },
            ],
        };

        const docChildren: any[] = [];

        // Optional title block
        if (title) {
            docChildren.push(new Paragraph({
                text:    title,
                heading: HeadingLevel.TITLE,
                spacing: { after: 300 },
            }));
        }

        // Process blocks
        for (const block of content as Block[]) {
            switch (block.type) {
                case 'heading':
                    docChildren.push(makeHeading(block));
                    break;
                case 'paragraph':
                    docChildren.push(makeParagraph(block));
                    break;
                case 'table':
                    docChildren.push(makeTable(block));
                    docChildren.push(new Paragraph({ text: '' })); // spacing after table
                    break;
                case 'list':
                    docChildren.push(...makeList(block));
                    docChildren.push(new Paragraph({ text: '' })); // spacing after list
                    break;
                case 'pageBreak':
                    docChildren.push(makePageBreak());
                    break;
            }
        }

        const doc = new Document({
            numbering: numberingConfig,
            creator: author ?? '9Lives AI',
            title:   title ?? '',
            sections: [{ children: docChildren }],
        });

        const buf = await Packer.toBuffer(doc);
        fs.writeFileSync(resolved, buf);

        const stats = fs.statSync(resolved);
        logger.info(`Word: file created at ${resolved} (${stats.size} bytes)`);

        return {
            success: true,
            path: resolved,
            size: stats.size,
            blocks: content.length,
        };
    },
});

// ── Tool: word.readFile ───────────────────────────────────────────────────

toolRegistry.register({
    name: 'word.readFile',
    description: 'Read an existing Word (.docx) file and return the content converted to Markdown format.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: "Absolute path of the Word file to read (e.g. /app/workspace/document.docx)",
            },
            maxChars: {
                type: 'number',
                description: "Maximum number of Markdown characters to return (default: 20000)",
                default: 20000,
            },
        },
        required: ['path'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { path: filePath, maxChars = 20000 } = input;
        logger.info(`Word: readFile "${filePath}"`);

        const resolved = resolveFilePath(filePath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);

        // mammoth has no official @types — cast to any to access convertToMarkdown
        const mammoth = (await import('mammoth')) as any;

        const result = await mammoth.convertToMarkdown({ path: resolved });

        if (result.messages?.length > 0) {
            const warnings = result.messages
                .filter((m: any) => m.type === 'warning')
                .map((m: any) => m.message);
            if (warnings.length > 0) {
                logger.warn(`Word readFile warnings: ${warnings.join('; ')}`);
            }
        }

        let markdown = result.value as string;
        const truncated = markdown.length > maxChars;
        if (truncated) markdown = markdown.slice(0, maxChars);

        const stats = fs.statSync(resolved);
        logger.info(`Word: readFile done — ${markdown.length} chars`);

        return {
            success: true,
            path: resolved,
            size: stats.size,
            truncated,
            totalChars: result.value.length,
            markdown: markdown.trim(),
        };
    },
});
