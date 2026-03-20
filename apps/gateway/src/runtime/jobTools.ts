// Copyright (c) 2026 Flavio Cerato
﻿import crypto from 'node:crypto';
import cron from 'node-cron';
import { query } from '../storage/pg/pool.js';
import { toolRegistry } from './toolRegistry.js';
import { reloadJobsUsingActiveServer } from './scheduler.js';
import { logger } from '../util/logger.js';

type JobTarget = {
    liveId?: string;
    crewId?: string;
};

function normalizeDateInput(value: any): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return String(value);
}

function resolveTarget(ctx: { liveId?: string }, input: any, options?: { allowImplicitLive?: boolean }): JobTarget {
    const allowImplicitLive = options?.allowImplicitLive ?? true;
    const liveId = input.liveId ? String(input.liveId) : undefined;
    const crewId = input.crewId ? String(input.crewId) : undefined;

    if (liveId && crewId) {
        throw new Error('Provide either liveId or crewId, not both');
    }

    if (liveId || crewId) {
        return { liveId, crewId };
    }

    if (allowImplicitLive && ctx.liveId) {
        return { liveId: String(ctx.liveId) };
    }

    throw new Error('liveId or crewId is required');
}

async function ensureTargetExists(target: JobTarget) {
    if (target.liveId) {
        const result = await query('SELECT id FROM lives WHERE id=$1', [target.liveId]);
        if (!result.rows.length) {
            throw new Error(`Live not found: ${target.liveId}`);
        }
        return;
    }

    if (target.crewId) {
        const result = await query('SELECT id FROM crews WHERE id=$1', [target.crewId]);
        if (!result.rows.length) {
            throw new Error(`Crew not found: ${target.crewId}`);
        }
    }
}

function targetLabel(target: JobTarget) {
    return target.liveId ? `live:${target.liveId}` : `crew:${target.crewId}`;
}

logger.info('jobTools module loaded');

toolRegistry.register({
    name: 'job.list',
    description: 'List scheduled cron jobs for a live or crew',
    inputSchema: {
        type: 'object',
        properties: {
            liveId: { type: 'string', description: 'Target live ID. If omitted, uses the current live.' },
            crewId: { type: 'string', description: 'Target crew ID.' }
        }
    },
    sideEffecting: false,
    handler: async (ctx, input) => {
        const target = resolveTarget(ctx, input, { allowImplicitLive: true });
        const where = target.liveId ? 'live_id=$1' : 'crew_id=$1';
        const value = target.liveId ?? target.crewId;

        const result = await query(
            `SELECT id, live_id AS "liveId", crew_id AS "crewId", name, cron_expr AS "cronExpr", prompt, enabled, start_date AS "startDate", end_date AS "endDate", last_run_at AS "lastRunAt", created_at AS "createdAt" FROM jobs WHERE ${where} ORDER BY created_at ASC`,
            [value]
        );

        return {
            target,
            jobs: result.rows
        };
    }
});

toolRegistry.register({
    name: 'job.create',
    description: 'Create a new cron job for a live or crew',
    inputSchema: {
        type: 'object',
        properties: {
            liveId: { type: 'string', description: 'ID live target. Se omesso usa il live corrente.' },
            crewId: { type: 'string', description: 'ID crew target.' },
            name: { type: 'string', description: 'Nome del job' },
            cronExpr: { type: 'string', description: 'Espressione cron (es: 0 9 * * *)' },
            prompt: { type: 'string', description: 'Prompt da eseguire quando il job parte' },
            startDate: { type: 'string', description: 'Data/ora inizio validita (ISO), opzionale' },
            endDate: { type: 'string', description: 'Data/ora fine validita (ISO), opzionale' }
        },
        required: ['cronExpr', 'prompt']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const target = resolveTarget(ctx, input, { allowImplicitLive: true });
        await ensureTargetExists(target);

        if (!cron.validate(input.cronExpr)) {
            throw new Error(`Invalid cron expression: ${input.cronExpr}`);
        }

        const id = crypto.randomUUID();
        await query(
            'INSERT INTO jobs (id, live_id, crew_id, name, cron_expr, prompt, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [
                id,
                target.liveId ?? null,
                target.crewId ?? null,
                input.name ?? '',
                input.cronExpr,
                input.prompt ?? '',
                normalizeDateInput(input.startDate) ?? null,
                normalizeDateInput(input.endDate) ?? null
            ]
        );

        await reloadJobsUsingActiveServer();
        return { id, target, status: 'created' };
    }
});

toolRegistry.register({
    name: 'job.update',
    description: 'Modifica un cron job esistente (nome, cron, prompt, date, enabled)',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'ID del job da modificare' },
            liveId: { type: 'string', description: 'ID live target. Se omesso usa il live corrente.' },
            crewId: { type: 'string', description: 'ID crew target.' },
            name: { type: 'string', description: 'Nuovo nome del job' },
            cronExpr: { type: 'string', description: 'Nuova espressione cron' },
            prompt: { type: 'string', description: 'Nuovo prompt del job' },
            startDate: { type: 'string', description: 'Nuova data/ora inizio (usa stringa vuota per rimuovere)' },
            endDate: { type: 'string', description: 'Nuova data/ora fine (usa stringa vuota per rimuovere)' },
            enabled: { type: 'boolean', description: 'Abilita/disabilita il job' }
        },
        required: ['id']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const id = String(input.id || '');
        if (!id) {
            throw new Error('id is required');
        }

        const target = resolveTarget(ctx, input, { allowImplicitLive: true });
        const existing = await query('SELECT id, live_id, crew_id FROM jobs WHERE id=$1', [id]);
        if (!existing.rows.length) {
            throw new Error(`Job not found: ${id}`);
        }

        const row = existing.rows[0];
        if (target.liveId && row.live_id !== target.liveId) {
            throw new Error(`Job ${id} does not belong to ${targetLabel(target)}`);
        }
        if (target.crewId && row.crew_id !== target.crewId) {
            throw new Error(`Job ${id} does not belong to ${targetLabel(target)}`);
        }

        if (input.cronExpr !== undefined && !cron.validate(input.cronExpr)) {
            throw new Error(`Invalid cron expression: ${input.cronExpr}`);
        }

        const normalizedStartDate = normalizeDateInput(input.startDate);
        const normalizedEndDate = normalizeDateInput(input.endDate);
        const hasStartDate = input.startDate !== undefined;
        const hasEndDate = input.endDate !== undefined;

        await query(
            `UPDATE jobs SET
                name = COALESCE($2, name),
                cron_expr = COALESCE($3, cron_expr),
                prompt = COALESCE($4, prompt),
                start_date = CASE WHEN $6 THEN $5::timestamptz ELSE start_date END,
                end_date = CASE WHEN $8 THEN $7::timestamptz ELSE end_date END,
                enabled = COALESCE($9, enabled)
             WHERE id = $1`,
            [
                id,
                input.name ?? null,
                input.cronExpr ?? null,
                input.prompt ?? null,
                normalizedStartDate ?? null,
                hasStartDate,
                normalizedEndDate ?? null,
                hasEndDate,
                input.enabled !== undefined ? Boolean(input.enabled) : null
            ]
        );

        await reloadJobsUsingActiveServer();
        return { id, target, status: 'updated' };
    }
});

toolRegistry.register({
    name: 'job.delete',
    description: 'Elimina un cron job per live o crew',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'ID del job da eliminare' },
            liveId: { type: 'string', description: 'ID live target. Se omesso usa il live corrente.' },
            crewId: { type: 'string', description: 'ID crew target.' }
        },
        required: ['id']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const target = resolveTarget(ctx, input, { allowImplicitLive: true });
        const id = String(input.id || '');

        const result = target.liveId
            ? await query('DELETE FROM jobs WHERE id=$1 AND live_id=$2', [id, target.liveId])
            : await query('DELETE FROM jobs WHERE id=$1 AND crew_id=$2', [id, target.crewId]);

        if (result.rowCount === 0) {
            throw new Error(`Job not found for ${targetLabel(target)}: ${id}`);
        }

        await reloadJobsUsingActiveServer();
        return { id, target, status: 'deleted' };
    }
});
