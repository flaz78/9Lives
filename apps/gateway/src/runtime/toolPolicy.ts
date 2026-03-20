// Copyright (c) 2026 Flavio Cerato
import { LiveDefinition } from './liveLoader.js';

export class ToolPolicy {
    isAllowed(live: LiveDefinition, toolName: string): boolean {
        const { tool_allow, tool_deny } = live.policy;

        // Deny takes precedence
        if (tool_deny.includes(toolName) || tool_deny.includes('*')) {
            return false;
        }

        // Check allow list
        if (tool_allow.includes(toolName) || tool_allow.includes('*')) {
            return true;
        }

        return false;
    }

    requiresApproval(live: LiveDefinition, sideEffecting: boolean): boolean {
        // For now, simplicity: if sideEffecting, we might want to check a global or per-live setting
        return sideEffecting; // TODO: make this configurable
    }
}

export const toolPolicy = new ToolPolicy();
