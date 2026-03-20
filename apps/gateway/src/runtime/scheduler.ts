// Copyright (c) 2026 Flavio Cerato
﻿import cron from 'node-cron';
import { query } from '../storage/pg/pool.js';
import { runLive } from './orchestrator.js';
import { runCrew } from './crewOrchestrator.js';
import { logger } from '../util/logger.js';
import type { WebSocketServer, WebSocket } from 'ws';

const scheduledTasks = new Map<string, cron.ScheduledTask>();
let activeWss: WebSocketServer | null = null;

export async function startScheduler(wss: WebSocketServer) {
    activeWss = wss;
    await reloadJobs(wss);
    logger.info('Cron scheduler started');
}

export async function reloadJobs(wss: WebSocketServer) {
    activeWss = wss;

    for (const [id, task] of scheduledTasks) {
        task.stop();
        scheduledTasks.delete(id);
    }

    let jobs: any[] = [];
    try {
        const res = await query('SELECT * FROM jobs WHERE enabled=true');
        jobs = res.rows;
    } catch (e: any) {
        logger.warn('Could not load jobs (table may not exist yet):', e.message);
        return;
    }

    for (const job of jobs) {
        if (!cron.validate(job.cron_expr)) {
            logger.warn(`Invalid cron expression for job ${job.id}: ${job.cron_expr}`);
            continue;
        }

        const task = cron.schedule(job.cron_expr, async () => {
            const now = Date.now();
            if (job.start_date && now < new Date(job.start_date).getTime()) return;

            if (job.end_date) {
                const end = new Date(job.end_date);
                if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
                    end.setHours(23, 59, 59, 999);
                }
                if (now > end.getTime()) return;
            }

            const targetKind = job.crew_id ? 'crew' : 'live';
            const targetId = job.crew_id || job.live_id;
            logger.info(`Running job ${job.id} for ${targetKind} ${targetId}`);

            const sessionKey = job.crew_id ? `cron:crew:${job.id}` : `cron:${job.id}:${now}`;
            broadcast(wss, 'job.run', {
                jobId: job.id,
                liveId: job.live_id,
                crewId: job.crew_id,
                sessionKey,
                status: 'started'
            });

            const baseRunOptions = {
                sessionKey,
                userMessage: job.prompt || 'Execute your scheduled task.',
                onDelta: (delta: string) => broadcast(wss, 'chat.delta', { sessionKey, delta }),
                onDone: (text: string) => {
                    broadcast(wss, 'chat.final', { sessionKey, text });
                    broadcast(wss, 'job.run', { jobId: job.id, status: 'done' });
                    query('UPDATE jobs SET last_run_at=now() WHERE id=$1', [job.id]).catch(() => { });
                },
                onError: (err: Error) => {
                    broadcast(wss, 'job.run', { jobId: job.id, status: 'error', message: err.message });
                },
            };

            if (job.crew_id) {
                await runCrew({
                    crewId: job.crew_id,
                    ...baseRunOptions,
                });
            } else if (job.live_id) {
                await runLive({
                    liveId: job.live_id,
                    ...baseRunOptions,
                });
            } else {
                logger.warn(`Skipping job ${job.id}: no live_id or crew_id configured`);
            }
        });

        scheduledTasks.set(job.id, task);
        logger.info(
            `Scheduled job ${job.id} [${job.cron_expr}] -> ${job.crew_id ? `crew:${job.crew_id}` : `live:${job.live_id}`} (Range: ${job.start_date || 'Any'} to ${job.end_date || 'Any'})`
        );
    }
}

export async function reloadJobsUsingActiveServer() {
    if (!activeWss) {
        throw new Error('Scheduler not initialized');
    }
    await reloadJobs(activeWss);
}

function broadcast(wss: WebSocketServer, event: string, payload: any) {
    const frame = JSON.stringify({ type: 'event', event, payload });
    wss.clients.forEach((client: WebSocket) => {
        if (client.readyState === 1) client.send(frame);
    });
}
