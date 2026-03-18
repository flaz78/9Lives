// Copyright (c) 2026 Flavio Cerato
import { query } from './storage/pg/pool.js';

async function run() {
    try {
        await query('ALTER TABLE jobs ADD COLUMN start_date TIMESTAMPTZ');
        console.log('Added start_date column');
    } catch (e: any) { console.log('start_date exists?', e.message); }

    try {
        await query('ALTER TABLE jobs ADD COLUMN end_date TIMESTAMPTZ');
        console.log('Added end_date column');
    } catch (e: any) { console.log('end_date exists?', e.message); }
    process.exit(0);
}

run();
