// Copyright (c) 2026 Flavio Cerato
import { GuardrailDefinition } from './guardrailLoader.js';
import { logger } from '../util/logger.js';

export interface GuardrailCheckResult {
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
}

/** Simple glob matcher supporting * and ** patterns (no external deps) */
function matchGlob(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === '**') return true;

    // Escape regex special chars except * and ?
    const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*')
        .replace(/\?/g, '.');

    return new RegExp(`^${regexStr}$`, 'i').test(value);
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
    return patterns.some(p => matchGlob(value, p));
}

export class GuardrailEnforcer {
    private totalToolCalls = 0;

    constructor(private guardrail: GuardrailDefinition) {}

    get maxIterations(): number {
        return this.guardrail.limits.max_iterations;
    }

    get maxToolCalls(): number {
        return this.guardrail.limits.max_tool_calls;
    }

    get effectiveGuardrail(): GuardrailDefinition {
        return this.guardrail;
    }

    checkToolCall(toolName: string, toolArgs: any): GuardrailCheckResult {
        // 1. Check total tool call limit
        this.totalToolCalls++;
        if (this.totalToolCalls > this.guardrail.limits.max_tool_calls) {
            return {
                allowed: false,
                reason: `Limite massimo di tool call raggiunto (${this.guardrail.limits.max_tool_calls}). Concludi con le informazioni disponibili.`,
            };
        }

        // 2. Check skill allow/deny
        const skillName = toolName.includes('.') ? toolName.split('.')[0] : toolName;
        if (!this.isSkillAllowed(skillName, toolName)) {
            return {
                allowed: false,
                reason: `Skill '${skillName}' bloccata dai guardrail. Strumento '${toolName}' non disponibile.`,
            };
        }

        // 3. Check filesystem constraints (for filesystem.* tools)
        if (toolName.startsWith('filesystem.')) {
            const targetPath = this.buildFilesystemPath(toolArgs);
            if (targetPath) {
                const fsCheck = this.checkFilesystemAccess(targetPath);
                if (!fsCheck.allowed) return fsCheck;
            }
        }

        // 4. Check API/URL constraints (for tools with url args)
        const urls = this.extractUrls(toolArgs);
        for (const url of urls) {
            const apiCheck = this.checkApiAccess(url);
            if (!apiCheck.allowed) return apiCheck;
        }

        // 5. Check confirmation requirement
        if (this.guardrail.confirmation_required.includes(toolName)) {
            return {
                allowed: true,
                requiresConfirmation: true,
                reason: `The instrument '${toolName}' requires user confirmation before execution.`,
            };
        }

        return { allowed: true };
    }

    /** Check if a skill name passes the allow/deny guardrail */
    isSkillAllowed(skillName: string, fullToolName?: string): boolean {
        const { allow, deny } = this.guardrail.skills;

        // Deny takes precedence — check both skill name and full tool name
        if (deny.includes(skillName) || deny.includes('*')) return false;
        if (fullToolName && deny.includes(fullToolName)) return false;

        // Check allow
        if (allow.includes('*') || allow.includes(skillName)) return true;
        if (fullToolName && allow.includes(fullToolName)) return true;

        // If allow list is explicit (no wildcard) and skill not in it → deny
        if (allow.length > 0 && !allow.includes('*')) return false;

        return true;
    }

    /** Filter a list of skill names, returning only those allowed by guardrails */
    filterAllowedSkills(skillNames: string[]): string[] {
        return skillNames.filter(name => this.isSkillAllowed(name));
    }

    private buildFilesystemPath(args: any): string | null {
        if (!args) return null;
        const subDir = args.subDir || args.sub_dir || args.path || '';
        const fileName = args.fileName || args.file_name || args.filename || '';
        if (!subDir && !fileName) return null;
        return fileName ? `${subDir}/${fileName}` : subDir;
    }

    private checkFilesystemAccess(targetPath: string): GuardrailCheckResult {
        const { allow, deny } = this.guardrail.filesystem;

        // Deny takes precedence
        if (matchesAnyPattern(targetPath, deny)) {
            return {
                allowed: false,
                reason: `Access to path '${targetPath}' denied by filesystem guardrails.`,
            };
        }

        // Check allow
        if (allow.includes('*') || allow.includes('**') || matchesAnyPattern(targetPath, allow)) {
            return { allowed: true };
        }

        // Not explicitly allowed → deny
        return {
            allowed: false,
            reason: `Path '${targetPath}' not present in the list of allowed paths.`,
        };
    }

    private extractUrls(args: any): string[] {
        if (!args || typeof args !== 'object') return [];
        const urls: string[] = [];
        if (typeof args.url === 'string') urls.push(args.url);
        if (Array.isArray(args.urls)) urls.push(...args.urls.filter((u: any) => typeof u === 'string'));
        return urls;
    }

    private checkApiAccess(url: string): GuardrailCheckResult {
        const { allow, deny } = this.guardrail.api;

        let hostname: string;
        try {
            hostname = new URL(url).hostname;
        } catch {
            hostname = url;
        }

        // Deny takes precedence
        if (matchesAnyPattern(url, deny) || matchesAnyPattern(hostname, deny)) {
            return {
                allowed: false,
                reason: `Access to API endpoint '${hostname}' denied by guardrails.`,
            };
        }

        // Check allow
        if (allow.includes('*') || matchesAnyPattern(url, allow) || matchesAnyPattern(hostname, allow)) {
            return { allowed: true };
        }

        return {
            allowed: false,
            reason: `API endpoint '${hostname}' not in the list of allowed endpoints.`,
        };
    }
}
