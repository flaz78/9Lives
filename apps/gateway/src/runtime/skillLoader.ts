// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../util/logger.js';

export interface SkillDefinition {
    name: string;
    version: string;
    description: string;
    tools: Array<{
        name: string;
        description: string;
        input: any;
    }>;
    rules: string;
}

export class SkillLoader {
    private skills: Map<string, SkillDefinition> = new Map();

    constructor(private skillsDir: string) { }

    async loadAll() {
        try {
            const folders = await fs.readdir(this.skillsDir);
            for (const folder of folders) {
                const skillPath = path.join(this.skillsDir, folder, 'SKILL.md');
                try {
                    await fs.access(skillPath);
                    await this.loadSkill(skillPath);
                } catch {
                    // No SKILL.md in this folder
                }
            }
        } catch (err) {
            logger.error('Failed to load skills', err);
        }
    }

    private async loadSkill(filePath: string) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const parts = content.split('---');
            if (parts.length < 3) return;

            const frontmatter = yaml.load(parts[1]) as any;
            const body = parts.slice(2).join('---');

            const rulesMatch = body.match(/# Regole d’uso\n([\s\S]*?)(?=\n#|$)/);

            const skill: SkillDefinition = {
                ...frontmatter,
                rules: rulesMatch ? rulesMatch[1].trim() : '',
            };

            this.skills.set(skill.name, skill);
            logger.info(`Loaded skill: ${skill.name} (${skill.version})`);
        } catch (err) {
            logger.error(`Failed to load skill from ${filePath}`, err);
        }
    }

    getSkill(name: string) {
        return this.skills.get(name);
    }

    getAll() {
        return Array.from(this.skills.values());
    }
}
