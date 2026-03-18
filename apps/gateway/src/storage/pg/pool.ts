// Copyright (c) 2026 Flavio Cerato
import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from '../../util/logger.js';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', err);
});

export async function query(text: string, params?: any[]) {
    return pool.query(text, params);
}

export async function waitForDb(maxRetries = 10, delayMs = 2000): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await query('SELECT 1');
            logger.info('Database is ready.');
            return;
        } catch (err: any) {
            logger.warn(`Waiting for database (attempt ${i + 1}/${maxRetries}): ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw new Error('Database not ready after maximum retries.');
}
