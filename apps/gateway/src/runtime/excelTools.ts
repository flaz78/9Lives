// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

logger.info('excelTools module loaded');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? '/app/workspace';

/**
 * Resolves the file path:
 * - If absolute → used as-is
 * - If relative → resolved under WORKSPACE_DIR (e.g. "report.xlsx" → "/app/workspace/report.xlsx")
 */
function resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(WORKSPACE_DIR, filePath);
}

// ── Tool: excel.createFile ────────────────────────────────────────────────

toolRegistry.register({
    name: 'excel.createFile',
    description: 'Creates an Excel file (.xlsx) with one or more sheets, headers and data rows. Returns the path of the created file.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: "Absolute path where to save the file (e.g.: /app/workspace/report.xlsx)",
            },
            sheets: {
                type: 'array',
                description: 'List of sheets to create in the Excel file',
                items: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: "Sheet name (e.g.: 'Sales', 'Summary')",
                        },
                        headers: {
                            type: 'array',
                            description: 'Column headers',
                            items: { type: 'string' },
                        },
                        rows: {
                            type: 'array',
                            description: 'Data rows. Each row is an array of values (strings or numbers).',
                            items: {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        },
                        columnWidths: {
                            type: 'array',
                            description: 'Optional column widths in characters (e.g.: [20, 15, 10])',
                            items: { type: 'number' },
                        },
                    },
                    required: ['name', 'headers', 'rows'],
                },
            },
        },
        required: ['path', 'sheets'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { path: filePath, sheets } = input;
        logger.info(`Excel: createFile "${filePath}" (${sheets.length} sheets)`);

        const resolved = resolveFilePath(filePath);
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = '9Lives AI';
        workbook.created = new Date();

        for (const sheet of sheets) {
            const ws = workbook.addWorksheet(sheet.name);

            // Header row — bold with background
            const headerRow = ws.addRow(sheet.headers);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4F46E5' }, // indigo
            };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
            headerRow.height = 20;

            // Data rows
            for (const row of sheet.rows) {
                const dataRow = ws.addRow(row);
                dataRow.alignment = { vertical: 'middle' };
            }

            // Alternating row colors
            for (let i = 2; i <= sheet.rows.length + 1; i++) {
                if (i % 2 === 0) {
                    const row = ws.getRow(i);
                    row.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF5F3FF' },
                    };
                }
            }

            // Column widths
            sheet.headers.forEach((_: string, idx: number) => {
                const col = ws.getColumn(idx + 1);
                if (sheet.columnWidths?.[idx]) {
                    col.width = sheet.columnWidths[idx];
                } else {
                    // Auto-size: max of header length and longest cell value
                    const maxLen = Math.max(
                        sheet.headers[idx]?.length ?? 10,
                        ...sheet.rows.map((r: string[]) => String(r[idx] ?? '').length),
                    );
                    col.width = Math.min(Math.max(maxLen + 2, 10), 60);
                }
            });

            // Freeze header row
            ws.views = [{ state: 'frozen', ySplit: 1 }];

            // Auto-filter on header row
            ws.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: sheet.headers.length },
            };
        }

        await workbook.xlsx.writeFile(resolved);

        const stats = fs.statSync(resolved);
        logger.info(`Excel: file created at ${resolved} (${stats.size} bytes)`);

        return {
            success: true,
            path: resolved,
            size: stats.size,
            sheets: sheets.map((s: any) => ({ name: s.name, rows: s.rows.length, columns: s.headers.length })),
        };
    },
});

// ── Tool: excel.readFile ──────────────────────────────────────────────────

toolRegistry.register({
    name: 'excel.readFile',
    description: 'Reads an existing Excel file (.xlsx) and returns the content as Markdown tables. Supports multi-sheet files.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: "Absolute path of the Excel file to read (e.g.: /app/workspace/report.xlsx)",
            },
            sheetNames: {
                type: 'array',
                items: { type: 'string' },
                description: "Names of sheets to read (optional). If omitted, reads all sheets.",
            },
            maxRows: {
                type: 'number',
                description: "Maximum number of rows to read per sheet (default: 500)",
                default: 500,
            },
        },
        required: ['path'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { path: filePath, sheetNames, maxRows = 500 } = input;
        logger.info(`Excel: readFile "${filePath}"`);

        const resolved = resolveFilePath(filePath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(resolved);

        const results: Array<{ sheet: string; columns: number; rows: number; markdown: string }> = [];
        let markdownOutput = '';

        workbook.eachSheet((ws) => {
            if (sheetNames && sheetNames.length > 0 && !sheetNames.includes(ws.name)) return;

            const allRows: string[][] = [];
            ws.eachRow({ includeEmpty: false }, (row) => {
                const cells: string[] = [];
                row.eachCell({ includeEmpty: true }, (cell) => {
                    let val = '';
                    if (cell.value !== null && cell.value !== undefined) {
                        if (typeof cell.value === 'object' && 'result' in (cell.value as any)) {
                            // Formula cell — use result
                            val = String((cell.value as any).result ?? '');
                        } else if (typeof cell.value === 'object' && 'text' in (cell.value as any)) {
                            // Rich text
                            val = String((cell.value as any).text ?? '');
                        } else {
                            val = String(cell.value);
                        }
                    }
                    cells.push(val.replace(/\|/g, '\\|').replace(/\n/g, ' '));
                });
                allRows.push(cells);
            });

            if (allRows.length === 0) return;

            // Normalize column count
            const colCount = Math.max(...allRows.map(r => r.length));
            const normalize = (row: string[]) => {
                const copy = [...row];
                while (copy.length < colCount) copy.push('');
                return copy;
            };

            const headers = normalize(allRows[0]);
            const dataRows = allRows.slice(1, maxRows + 1).map(normalize);
            const truncated = allRows.length - 1 > maxRows;

            // Build markdown table
            const sep = headers.map(() => '---');
            const mdTable = [
                `| ${headers.join(' | ')} |`,
                `| ${sep.join(' | ')} |`,
                ...dataRows.map(r => `| ${r.join(' | ')} |`),
            ].join('\n');

            const sheetMd = `## Sheet: ${ws.name}\n\n${mdTable}${truncated ? `\n\n_... (showing ${maxRows} rows out of ${allRows.length - 1} total)_` : ''}\n`;
            markdownOutput += sheetMd + '\n';

            results.push({ sheet: ws.name, columns: colCount, rows: dataRows.length, markdown: sheetMd });
        });

        if (results.length === 0) throw new Error('No sheets found (or none match the specified names).');

        logger.info(`Excel: readFile done — ${results.length} sheets read`);

        return {
            success: true,
            path: resolved,
            sheets: results.map(r => ({ sheet: r.sheet, columns: r.columns, rows: r.rows })),
            markdown: markdownOutput.trim(),
        };
    },
});
