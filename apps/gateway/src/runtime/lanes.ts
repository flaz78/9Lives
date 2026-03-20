// Copyright (c) 2026 Flavio Cerato
import PQueue from 'p-queue';
import { logger } from '../util/logger.js';

export class SessionLanes {
    private lanes: Map<string, PQueue> = new Map();

    constructor(private concurrencyLimit: number = 4) { }

    async enqueue(sessionKey: string, task: () => Promise<void>) {
        let lane = this.lanes.get(sessionKey);
        if (!lane) {
            lane = new PQueue({ concurrency: 1 });
            this.lanes.set(sessionKey, lane);
        }

        return lane.add(task).catch(err => {
            logger.error(`Task failed in lane ${sessionKey}`, err);
        });
    }
}

export const lanes = new SessionLanes();
