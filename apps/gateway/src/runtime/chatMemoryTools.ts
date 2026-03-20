// Copyright (c) 2026 Flavio Cerato
import { query } from '../storage/pg/pool.js';
import { logger } from '../util/logger.js';
import { toolRegistry } from './toolRegistry.js';

logger.info('chatMemoryTools module loaded');

toolRegistry.register({
    name: 'chat.clearMemory',
    description: 'Clears the conversational memory of the current session for the active live',
    inputSchema: {
        type: 'object',
        properties: {
            confirm: {
                type: 'boolean',
                description: "Must be true to execute memory reset"
            }
        },
        required: ['confirm']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        if (!input?.confirm) {
            return {
                success: false,
                message: 'Reset cancelled: set confirm=true only when the user explicitly asks to clear the memory.'
            };
        }

        await query(
            'DELETE FROM chat_history WHERE live_id = $1 AND session_key = $2',
            [ctx.liveId, ctx.sessionKey]
        );

        logger.info(`Chat memory cleared for live ${ctx.liveId}, session ${ctx.sessionKey}`);

        return {
            success: true,
            liveId: ctx.liveId,
            sessionKey: ctx.sessionKey,
            message: 'Conversational memory cleared for the current session.'
        };
    }
});
