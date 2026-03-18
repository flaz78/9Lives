// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './pool.js';
import { logger } from '../../util/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export async function runMigrations() {
    logger.info('Checking for database migrations...');

    try {
        // Create migrations table if it doesn't exist
        await query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                applied_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        const files = await fs.readdir(MIGRATIONS_DIR);
        const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

        for (const file of sqlFiles) {
            const check = await query('SELECT 1 FROM _migrations WHERE name = $1', [file]);

            if (check.rows.length === 0) {
                logger.info(`Applying migration: ${file}`);
                const sqlRaw = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
                const sql = sqlRaw.replace(/^\uFEFF/, '');

                await query('BEGIN');
                try {
                    await query(sql);
                    await query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
                    await query('COMMIT');
                    logger.info(`Migration ${file} applied successfully.`);
                } catch (err: any) {
                    await query('ROLLBACK');
                    logger.error(`Failed to apply migration ${file}:`, err.message);
                    throw err;
                }
            }
        }

        logger.info('All migrations checked/applied.');
    } catch (err: any) {
        logger.error('Migration runner failed:', err.message);
        throw err;
    }
}
