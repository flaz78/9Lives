// Copyright (c) 2026 Flavio Cerato
import { logger } from '../util/logger.js';

export interface ToolContext {
    sessionKey: string;
    liveId: string;
    channelContext: any;
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
    handler: (ctx: ToolContext, input: any) => Promise<any>;
    sideEffecting: boolean;
}

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

    register(tool: ToolDefinition) {
        this.tools.set(tool.name, tool);
        logger.info(`Registered tool: ${tool.name}`);
    }

    getTool(name: string) {
        return this.tools.get(name);
    }

    getAll() {
        return Array.from(this.tools.values());
    }
}

export const toolRegistry = new ToolRegistry();
