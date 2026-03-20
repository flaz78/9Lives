// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../util/logger.js';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';

export interface GuardrailSkills {
    allow: string[];
    deny: string[];
}

export interface GuardrailPaths {
    allow: string[];
    deny: string[];
}

export interface GuardrailLimits {
    max_iterations: number;
    max_tool_calls: number;
}

export interface GuardrailDefinition {
    skills: GuardrailSkills;
    filesystem: GuardrailPaths;
    api: GuardrailPaths;
    limits: GuardrailLimits;
    confirmation_required: string[];
}

interface PartialGuardrailDefinition {
    skills?: Partial<GuardrailSkills>;
    filesystem?: Partial<GuardrailPaths>;
    api?: Partial<GuardrailPaths>;
    limits?: Partial<GuardrailLimits>;
    confirmation_required?: string[];
}

interface StoredSystemGuardrail {
    enabled?: boolean;
    content?: string;
}

const DEFAULTS: GuardrailDefinition = {
    skills: { allow: ['*'], deny: [] },
    filesystem: { allow: ['**'], deny: ['*.env', '*.key', '*.pem'] },
    api: { allow: ['*'], deny: [] },
    limits: { max_iterations: 10, max_tool_calls: 30 },
    confirmation_required: [],
};

const DISABLED_SYSTEM_GUARDRAIL: GuardrailDefinition = {
    skills: { allow: ['*'], deny: [] },
    filesystem: { allow: ['**'], deny: [] },
    api: { allow: ['*'], deny: [] },
    limits: { max_iterations: 999, max_tool_calls: 999 },
    confirmation_required: [],
};

function toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') return [val];
    return [];
}

function parsePartial(raw: any): PartialGuardrailDefinition {
    if (!raw || typeof raw !== 'object') return {};
    const result: PartialGuardrailDefinition = {};

    if (raw.skills) {
        const allow = toStringArray(raw.skills.allow ?? raw.skills.allowed);
        const deny = toStringArray(raw.skills.deny ?? raw.skills.denied ?? raw.skills.blocked);
        if (allow.length > 0 || deny.length > 0) {
            result.skills = {};
            if (allow.length > 0) result.skills.allow = allow;
            if (deny.length > 0) result.skills.deny = deny;
        }
    }
    if (raw.filesystem) {
        const allow = toStringArray(raw.filesystem.allow);
        const deny = toStringArray(raw.filesystem.deny);
        if (allow.length > 0 || deny.length > 0) {
            result.filesystem = {};
            if (allow.length > 0) result.filesystem.allow = allow;
            if (deny.length > 0) result.filesystem.deny = deny;
        }
    }
    if (raw.api) {
        const allow = toStringArray(raw.api.allow);
        const deny = toStringArray(raw.api.deny);
        if (allow.length > 0 || deny.length > 0) {
            result.api = {};
            if (allow.length > 0) result.api.allow = allow;
            if (deny.length > 0) result.api.deny = deny;
        }
    }
    if (raw.limits) {
        const limits: Partial<GuardrailLimits> = {};
        if (raw.limits.max_iterations !== undefined || raw.limits.max_steps !== undefined) {
            limits.max_iterations = Number(raw.limits.max_iterations ?? raw.limits.max_steps);
        }
        if (raw.limits.max_tool_calls !== undefined) {
            limits.max_tool_calls = Number(raw.limits.max_tool_calls);
        }
        if (Object.keys(limits).length > 0) {
            result.limits = limits;
        }
    }
    if (raw.confirmation_required) {
        const confirmationRequired = toStringArray(raw.confirmation_required);
        if (confirmationRequired.length > 0) {
            result.confirmation_required = confirmationRequired;
        }
    }

    return result;
}

function applyDefaults(partial: PartialGuardrailDefinition): GuardrailDefinition {
    return {
        skills: {
            allow: partial.skills?.allow ?? [...DEFAULTS.skills.allow],
            deny: partial.skills?.deny ?? [...DEFAULTS.skills.deny],
        },
        filesystem: {
            allow: partial.filesystem?.allow ?? [...DEFAULTS.filesystem.allow],
            deny: partial.filesystem?.deny ?? [...DEFAULTS.filesystem.deny],
        },
        api: {
            allow: partial.api?.allow ?? [...DEFAULTS.api.allow],
            deny: partial.api?.deny ?? [...DEFAULTS.api.deny],
        },
        limits: {
            max_iterations: partial.limits?.max_iterations ?? DEFAULTS.limits.max_iterations,
            max_tool_calls: partial.limits?.max_tool_calls ?? DEFAULTS.limits.max_tool_calls,
        },
        confirmation_required: partial.confirmation_required ?? [...DEFAULTS.confirmation_required],
    };
}

function intersectAllow(global: string[], local: string[]): string[] {
    if (global.includes('*')) return [...local];
    if (local.includes('*')) return [...global];
    return global.filter(g => local.includes(g));
}

function unionDeny(global: string[], local: string[]): string[] {
    return [...new Set([...global, ...local])];
}

export class GuardrailLoader {
    constructor(private bootstrapDir: string) {}

    private parseMarkdownContent(content: string): GuardrailDefinition {
        const parts = content.split('---');
        if (parts.length < 3) {
            logger.warn('GUARDRAIL.md has no YAML frontmatter, using defaults');
            return { ...DEFAULTS };
        }
        const frontmatter = yaml.load(parts[1]) as any;
        return applyDefaults(parsePartial(frontmatter));
    }

    private async loadFromDatabase(): Promise<GuardrailDefinition | null> {
        try {
            const res = await query("SELECT ciphertext FROM secrets WHERE key='system.guardrail'");
            if (!res.rows.length) return null;

            const raw = JSON.parse(decrypt(res.rows[0].ciphertext as string)) as StoredSystemGuardrail | string;
            if (typeof raw === 'string') {
                return this.parseMarkdownContent(raw);
            }

            if (raw?.enabled === false) {
                logger.info('System guardrail disabled from settings');
                return {
                    ...DISABLED_SYSTEM_GUARDRAIL,
                    skills: { ...DISABLED_SYSTEM_GUARDRAIL.skills },
                    filesystem: { ...DISABLED_SYSTEM_GUARDRAIL.filesystem },
                    api: { ...DISABLED_SYSTEM_GUARDRAIL.api },
                    limits: { ...DISABLED_SYSTEM_GUARDRAIL.limits },
                    confirmation_required: [...DISABLED_SYSTEM_GUARDRAIL.confirmation_required],
                };
            }

            if (typeof raw?.content === 'string' && raw.content.trim().length > 0) {
                return this.parseMarkdownContent(raw.content);
            }
        } catch (err: any) {
            logger.warn(`Failed to load system guardrail override: ${err.message}`);
        }

        return null;
    }

    async loadGlobal(): Promise<GuardrailDefinition> {
        const dbGuardrail = await this.loadFromDatabase();
        if (dbGuardrail) return dbGuardrail;

        const filePath = path.join(this.bootstrapDir, 'GUARDRAIL.md');
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return this.parseMarkdownContent(content);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                logger.info('No GUARDRAIL.md found in bootstrap dir, using defaults');
            } else {
                logger.warn(`Failed to load GUARDRAIL.md: ${err.message}`);
            }
            return { ...DEFAULTS };
        }
    }

    loadForLive(liveRow: any): PartialGuardrailDefinition {
        const raw = liveRow?.guardrail;
        if (!raw) return {};
        return parsePartial(raw);
    }

    merge(global: GuardrailDefinition, perLive: PartialGuardrailDefinition): GuardrailDefinition {
        return {
            skills: {
                allow: perLive.skills?.allow ? intersectAllow(global.skills.allow, perLive.skills.allow) : [...global.skills.allow],
                deny: perLive.skills?.deny ? unionDeny(global.skills.deny, perLive.skills.deny) : [...global.skills.deny],
            },
            filesystem: {
                allow: perLive.filesystem?.allow ? intersectAllow(global.filesystem.allow, perLive.filesystem.allow) : [...global.filesystem.allow],
                deny: perLive.filesystem?.deny ? unionDeny(global.filesystem.deny, perLive.filesystem.deny) : [...global.filesystem.deny],
            },
            api: {
                allow: perLive.api?.allow ? intersectAllow(global.api.allow, perLive.api.allow) : [...global.api.allow],
                deny: perLive.api?.deny ? unionDeny(global.api.deny, perLive.api.deny) : [...global.api.deny],
            },
            limits: {
                max_iterations: Math.min(
                    global.limits.max_iterations,
                    perLive.limits?.max_iterations ?? global.limits.max_iterations
                ),
                max_tool_calls: Math.min(
                    global.limits.max_tool_calls,
                    perLive.limits?.max_tool_calls ?? global.limits.max_tool_calls
                ),
            },
            confirmation_required: unionDeny(
                global.confirmation_required,
                perLive.confirmation_required ?? []
            ),
        };
    }
}
