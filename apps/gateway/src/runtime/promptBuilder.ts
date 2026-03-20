// Copyright (c) 2026 Flavio Cerato
import fs from 'fs/promises';
import path from 'path';
import { LiveDefinition } from './liveLoader.js';
import { SkillDefinition } from './skillLoader.js';
import { GuardrailDefinition } from './guardrailLoader.js';
import { logger } from '../util/logger.js';

export class PromptBuilder {
    constructor(private bootstrapDir: string) { }

    async buildSystemPrompt(live: LiveDefinition, skills: SkillDefinition[], guardrail?: GuardrailDefinition) {
        let prompt = `Current Time: ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}\n\n`;

        // 1. Bootstrap files
        try {
            const bootstrapFiles = await fs.readdir(this.bootstrapDir);
            for (const file of bootstrapFiles) {
                if (file.endsWith('.md') && file !== 'GUARDRAIL.md') {
                    const content = await fs.readFile(path.join(this.bootstrapDir, file), 'utf8');
                    prompt += `## ${file}\n${content}\n\n`;
                }
            }
        } catch (err: any) {
            logger.warn(`Failed to load bootstrap files for prompt: ${err.message}`);
        }

        // 2. Live Personality & rules
        prompt += `## Personality / SOUL\n${live.personality}\n\n`;
        prompt += `## Operating Rules\n${live.operating_rules}\n\n`;

        // 3. Skills information
        if (skills.length > 0) {
            prompt += `## Available Skills\n`;
            for (const skill of skills) {
                prompt += `### ${skill.name}\n${skill.description}\nRules: ${skill.rules}\nTools:\n`;
                for (const tool of skill.tools) {
                    prompt += `- ${tool.name}: ${tool.description}\n`;
                }
                prompt += `\n`;
            }
        }

        // 4. Policy reminders
        prompt += `## System Policy\n`;
        prompt += `- Allowed tools: ${live.policy.tool_allow.join(', ')}\n`;
        prompt += `- Denied tools: ${live.policy.tool_deny.join(', ')}\n`;

        // 5. Guardrails (hard constraints)
        if (guardrail) {
            prompt += `\n## Guardrails (Vincoli Operativi)\n`;
            prompt += `I seguenti vincoli sono applicati automaticamente dal sistema e NON possono essere ignorati.\n\n`;

            if (guardrail.skills.deny.length > 0) {
                prompt += `- Skill bloccate: ${guardrail.skills.deny.join(', ')}\n`;
            }
            if (guardrail.skills.allow.length > 0 && !guardrail.skills.allow.includes('*')) {
                prompt += `- Skill consentite: ${guardrail.skills.allow.join(', ')}\n`;
            }
            if (guardrail.confirmation_required.length > 0) {
                prompt += `- Strumenti che richiedono conferma utente: ${guardrail.confirmation_required.join(', ')}\n`;
            }
            prompt += `- Iterazioni massime: ${guardrail.limits.max_iterations}\n`;
            prompt += `- Tool call massime: ${guardrail.limits.max_tool_calls}\n`;

            if (guardrail.filesystem.deny.length > 0) {
                prompt += `- Path filesystem negati: ${guardrail.filesystem.deny.join(', ')}\n`;
            }
            if (guardrail.api.deny.length > 0) {
                prompt += `- API endpoint negati: ${guardrail.api.deny.join(', ')}\n`;
            }
        }

        return prompt;
    }
}

