// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../util/logger.js';

export interface LiveDefinition {
    id: string;
    name: string;
    description: string;
    model: {
        provider: string;
        name: string;
    };
    routing: {
        default?: boolean;
    };
    skills: string[];
    policy: {
        tool_allow: string[];
        tool_deny: string[];
    };
    memory: {
        mode: string;
        files: string[];
    };
    /** Per-live guardrail overrides (merged with global GUARDRAIL.md at runtime) */
    guardrail?: {
        skills?: { allow?: string[]; deny?: string[] };
        filesystem?: { allow?: string[]; deny?: string[] };
        api?: { allow?: string[]; deny?: string[] };
        limits?: { max_iterations?: number; max_tool_calls?: number };
        confirmation_required?: string[];
    };
    personality: string;
    operating_rules: string;
}

export class LiveLoader {
    private lives: Map<string, LiveDefinition> = new Map();

    constructor(private livesDir: string) { }

    async loadAll() {
        try {
            const files = await fs.readdir(this.livesDir);
            for (const file of files) {
                if (file.endsWith('.live.md')) {
                    await this.loadLive(path.join(this.livesDir, file));
                }
            }
        } catch (err) {
            logger.error('Failed to load lives', err);
        }
    }

    private async loadLive(filePath: string) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const parts = content.split('---');
            if (parts.length < 3) return;

            const frontmatter = yaml.load(parts[1]) as any;
            const body = parts.slice(2).join('---');

            const personalityMatch = body.match(/# Personality \/ SOUL\n([\s\S]*?)(?=\n#|$)/);
            const rulesMatch = body.match(/# Operating rules\n([\s\S]*?)(?=\n#|$)/);

            const live: LiveDefinition = {
                ...frontmatter,
                personality: personalityMatch ? personalityMatch[1].trim() : '',
                operating_rules: rulesMatch ? rulesMatch[1].trim() : '',
            };

            this.lives.set(live.id, live);
            logger.info(`Loaded live: ${live.name} (${live.id})`);
        } catch (err) {
            logger.error(`Failed to load live from ${filePath}`, err);
        }
    }

    getLive(id: string) {
        return this.lives.get(id);
    }

    getAll() {
        return Array.from(this.lives.values());
    }

    getDefaultLive() {
        return this.getAll().find(l => l.routing.default);
    }
}
