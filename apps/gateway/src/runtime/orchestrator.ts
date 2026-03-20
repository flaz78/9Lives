// Copyright (c) 2026 Flavio Cerato
import OpenAI from 'openai';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import { PromptBuilder } from './promptBuilder.js';
import { SkillDefinition, SkillLoader } from './skillLoader.js';
import { toolRegistry } from './toolRegistry.js';
import { GuardrailLoader } from './guardrailLoader.js';
import { GuardrailEnforcer } from './guardrailEnforcer.js';

const workspaceBootstrapDir = path.join(process.cwd(), 'workspace/bootstrap');
const packagedBootstrapDir = path.join(process.cwd(), 'bootstrap');
const BOOTSTRAP_DIR = process.env.BOOTSTRAP_DIR
    ?? (fsSync.existsSync(workspaceBootstrapDir) ? workspaceBootstrapDir : packagedBootstrapDir);
const SKILLS_DIR = process.env.SKILLS_DIR ?? path.join(process.cwd(), 'workspace/skills');
const BUILTIN_SKILLS = ['chat_memory'];

const promptBuilder = new PromptBuilder(BOOTSTRAP_DIR);
const skillLoader = new SkillLoader(SKILLS_DIR);
const guardrailLoader = new GuardrailLoader(BOOTSTRAP_DIR);
const MEMORY_EXCHANGES_LIMIT = 10;
const MEMORY_MESSAGE_LIMIT = MEMORY_EXCHANGES_LIMIT * 2;
const MAX_TOOL_CONTENT_CHARS = 24_000;
const MAX_TOOL_STRING_CHARS = 8_000;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SAME_TOOL_CALLS = 2;

export interface RunOptions {
    liveId: string;
    sessionKey: string;
    userMessage: string;
    channelContext?: any;
    allowedToolNames?: string[];
    onDelta?: (delta: string) => void;
    onDone?: (fullText: string) => void;
    onError?: (err: Error) => void;
    onToolResult?: (toolEvent: { toolName: string; args: any; result: any }) => void;
}

async function getOpenAIClient(config?: { apiKey?: string; baseURL?: string }) {
    try {
        if (config?.apiKey) {
            return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
        }

        const res = await query("SELECT ciphertext FROM secrets WHERE key='openai.api_key'");
        if (!res.rows.length) throw new Error('OpenAI API key not configured. Go to Settings → LLM to configure it.');
        const apiKey = JSON.parse(decrypt(res.rows[0].ciphertext as any));
        return new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL });
    } catch (e: any) {
        throw new Error(`Cannot create OpenAI client: ${e.message}`);
    }
}

async function getLive(liveId: string) {
    const res = await query(
        'SELECT id, name, system_prompt, model_provider, model_name, skills, llm_config_id, guardrail FROM lives WHERE id=$1',
        [liveId]
    );
    if (!res.rows.length) throw new Error(`Live not found: ${liveId}`);
    return res.rows[0];
}

function truncateString(value: string, limit = MAX_TOOL_STRING_CHARS) {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}... [truncated ${value.length - limit} chars]`;
}

function sanitizeToolResult(value: any, options?: { preserveContentFields?: boolean }): any {
    if (typeof value === 'string') {
        return truncateString(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeToolResult(item, options));
    }

    if (value && typeof value === 'object') {
        const sanitized: Record<string, any> = {};
        for (const [key, item] of Object.entries(value)) {
            const lowered = key.toLowerCase();
            if (lowered === 'base64' || lowered === 'datauri') {
                if (typeof item === 'string' && item.length > 512) {
                    sanitized[key] = `[omitted large ${key} payload: ${item.length} chars]`;
                    continue;
                }
            }
            if (lowered === 'content' && !options?.preserveContentFields) {
                if (typeof item === 'string' && item.length > 512) {
                    sanitized[key] = `[omitted large ${key} payload: ${item.length} chars]`;
                    continue;
                }
            }
            sanitized[key] = sanitizeToolResult(item, options);
        }
        return sanitized;
    }

    return value;
}

function serializeToolResult(result: any) {
    const sanitized = sanitizeToolResult(result);
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= MAX_TOOL_CONTENT_CHARS) {
        return serialized;
    }
    return JSON.stringify({
        warning: `Tool result truncated from ${serialized.length} to ${MAX_TOOL_CONTENT_CHARS} chars`,
        preview: serialized.slice(0, MAX_TOOL_CONTENT_CHARS)
    });
}

async function buildUserMessageContent(userMessage: string, channelContext?: any) {
    const attachments = Array.isArray(channelContext?.attachments) ? channelContext.attachments : [];
    const imageAttachments = attachments.filter((item: any) => {
        const mimeType = String(item?.mimeType || '');
        return mimeType.startsWith('image/') && item?.path;
    });

    if (imageAttachments.length === 0) {
        return userMessage;
    }

    const content: any[] = [{ type: 'text', text: userMessage }];

    for (const image of imageAttachments.slice(0, 3)) {
        try {
            const buffer = await fs.readFile(image.path);
            if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
                content.push({
                    type: 'text',
                    text: `[Image omitted because it exceeds ${MAX_INLINE_IMAGE_BYTES} bytes: ${image.path}]`
                });
                continue;
            }

            const mimeType = image.mimeType || 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            content.push({
                type: 'image_url',
                image_url: { url: dataUrl }
            });
        } catch (err: any) {
            logger.warn(`Failed to inline image attachment ${image.path}: ${err.message}`);
            content.push({
                type: 'text',
                text: `[Image unavailable: ${image.path}]`
            });
        }
    }

    return content;
}

export async function runLive(opts: RunOptions): Promise<string> {
    const { liveId, sessionKey, userMessage, channelContext, allowedToolNames: requestedToolNames, onDelta, onDone, onError, onToolResult } = opts;

    try {
        const live = await getLive(liveId);
        let apiKey = process.env.OPENAI_API_KEY;
        let baseUrl = process.env.OPENAI_BASE_URL;

        if (live.llm_config_id) {
            const configRes = await query('SELECT provider, base_url, api_key_cipher FROM llm_configs WHERE id=$1', [live.llm_config_id]);
            if (configRes.rows.length > 0) {
                const config = configRes.rows[0];
                baseUrl = config.base_url || baseUrl;

                // If provider is google and no baseUrl, use Gemini OpenAI-compatible endpoint
                if (config.provider === 'google' && !config.base_url) {
                    baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
                }

                if (config.api_key_cipher) {
                    const { decrypt } = await import('../util/crypto.js');
                    apiKey = JSON.parse(decrypt(config.api_key_cipher as string));
                }
            }
        }

        logger.info(`Initializing OpenAI client for live ${liveId} (BaseURL: ${baseUrl || 'OpenAI Default'})`);
        const client = await getOpenAIClient({ apiKey, baseURL: baseUrl });

        // Load and merge guardrails (global + per-live)
        const globalGuardrail = await guardrailLoader.loadGlobal();
        const liveGuardrail = guardrailLoader.loadForLive(live);
        const effectiveGuardrail = guardrailLoader.merge(globalGuardrail, liveGuardrail);
        const enforcer = new GuardrailEnforcer(effectiveGuardrail);
        logger.info(`Guardrails loaded for live ${liveId}: maxIter=${enforcer.maxIterations}, maxTools=${enforcer.maxToolCalls}, denied=${effectiveGuardrail.skills.deny.join(',') || 'none'}`);

        // Load associated skills
        await skillLoader.loadAll();
        const associatedSkillNames = Array.from(new Set([...(live.skills || []), ...BUILTIN_SKILLS]));
        // Filter skills through guardrails (blocked skills never reach the LLM)
        const guardrailFilteredSkills = enforcer.filterAllowedSkills(associatedSkillNames);
        const associatedSkills = guardrailFilteredSkills
            .map((name: string) => skillLoader.getSkill(name))
            .filter((skill): skill is SkillDefinition => Boolean(skill));

        // Build composite system prompt
        const systemPrompt = await promptBuilder.buildSystemPrompt({
            ...live,
            personality: live.system_prompt,
            operating_rules: '',
            policy: { tool_allow: [], tool_deny: [] }
        } as any, associatedSkills, effectiveGuardrail);

        // Map skill tools to OpenAI tools (OpenAI doesn't allow dots in names)
        const tools = associatedSkills.flatMap((s: any) => s.tools.map((t: any) => ({
            type: 'function' as const,
            function: {
                name: t.name.replace(/\./g, '__'),
                description: t.description,
                parameters: t.input,
            }
        })));
        const filteredTools = Array.isArray(requestedToolNames) && requestedToolNames.length > 0
            ? tools.filter((tool) => requestedToolNames.includes(tool.function.name.replace(/__/g, '.')))
            : tools;
        const allowedToolNames = new Set(filteredTools.map((tool) => tool.function.name.replace(/__/g, '.')));

        // 5. Fetch chat history (last 10 user/assistant exchanges)
        const historyRes = await query(
            'SELECT role, content FROM chat_history WHERE live_id=$1 AND session_key=$2 ORDER BY created_at DESC, id DESC LIMIT $3',
            [liveId, sessionKey, MEMORY_MESSAGE_LIMIT]
        );
        const history = historyRes.rows.reverse();

        const currentUserContent = await buildUserMessageContent(userMessage, channelContext);

        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: currentUserContent },
        ];

        let fullText = '';
        let iteration = 0;
        const maxIterations = enforcer.maxIterations;
        const toolCallCounts = new Map<string, number>();

        while (iteration < maxIterations) {
            iteration++;

            let modelName = live.model_name ?? 'gpt-4o-mini';
            // Google Gemini OpenAI endpoint requires 'models/' prefix
            if (live.llm_config_id) {
                const configRes = await query('SELECT provider FROM llm_configs WHERE id=$1', [live.llm_config_id]);
                if (configRes.rows.length > 0 && configRes.rows[0].provider === 'google') {
                    if (!modelName.startsWith('models/')) {
                        modelName = `models/${modelName}`;
                    }
                }
            }

            logger.info(`Requesting completion for ${liveId} (Model: ${modelName}, Iteration: ${iteration}, BaseURL: ${client.baseURL})`);
            const completion = await client.chat.completions.create({
                model: modelName,
                messages: messages,
                tools: filteredTools.length > 0 ? filteredTools : undefined,
                tool_choice: filteredTools.length > 0 ? 'auto' : undefined,
            });

            const responseMessage = completion.choices[0].message;
            messages.push(responseMessage);

            if (responseMessage.content) {
                fullText += responseMessage.content;
                onDelta?.(responseMessage.content);
            }

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                for (const toolCall of responseMessage.tool_calls) {
                    const sanitizedName = toolCall.function.name;
                    const realName = sanitizedName.replace(/__/g, '.');
                    const toolArgs = JSON.parse(toolCall.function.arguments);
                    const callFingerprint = `${realName}:${JSON.stringify(toolArgs)}`;
                    const callCount = (toolCallCounts.get(callFingerprint) ?? 0) + 1;
                    toolCallCounts.set(callFingerprint, callCount);

                    logger.info(
                        `Live ${liveId} called tool: ${realName} (as ${sanitizedName}). Allowed tools: ${Array.from(allowedToolNames).join(', ')}`
                    );

                    if (!allowedToolNames.has(realName)) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: JSON.stringify({ error: `Tool ${realName} is not enabled for this live` }),
                        });
                        logger.warn(`Blocked non-enabled tool call: ${realName} for live ${liveId}`);
                        continue;
                    }

                    if (callCount > MAX_SAME_TOOL_CALLS) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: JSON.stringify({
                                error: `Repeated tool call blocked for ${realName}. Use the previous result and conclude the task.`
                            }),
                        });
                        logger.warn(`Blocked repeated tool call ${realName} for live ${liveId}`);
                        continue;
                    }

                    // Guardrail enforcement
                    const guardrailResult = enforcer.checkToolCall(realName, toolArgs);
                    if (!guardrailResult.allowed) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: JSON.stringify({ error: guardrailResult.reason, guardrail_blocked: true }),
                        });
                        logger.warn(`Guardrail blocked tool: ${realName} for live ${liveId} — ${guardrailResult.reason}`);
                        continue;
                    }
                    if (guardrailResult.requiresConfirmation) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: JSON.stringify({
                                confirmation_required: true,
                                tool: realName,
                                reason: guardrailResult.reason,
                            }),
                        });
                        logger.info(`Guardrail requires confirmation for: ${realName} for live ${liveId}`);
                        continue;
                    }

                    const tool = toolRegistry.getTool(realName);
                    let result;
                    if (tool) {
                        try {
                            result = await tool.handler({
                                sessionKey: opts.sessionKey,
                                liveId,
                                channelContext
                            }, toolArgs);
                        } catch (err: any) {
                            result = { error: err.message };
                            logger.error(`Tool error [${realName}]`, err);
                        }
                    } else {
                        result = { error: `Tool ${realName} not found` };
                        logger.warn(`Tool not found: ${realName}`);
                    }

                    onToolResult?.({
                        toolName: realName,
                        args: toolArgs,
                        result: sanitizeToolResult(result, { preserveContentFields: true }),
                    });

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: serializeToolResult(result),
                    });
                }
                // Continue loop with tool results
                continue;
            }

            // No more tool calls, we are done
            break;
        }

        if (iteration >= maxIterations && fullText.trim().length === 0) {
            fullText = 'Non sono riuscito a completare il compito in modo affidabile entro il limite operativo. Riformulo il task o restringo la richiesta e riprovo.';
        } else if (iteration >= maxIterations) {
            fullText += '\n\n[Interrotto: raggiunto il limite massimo di iterazioni operative.]';
        }

        onDone?.(fullText);

        // 6. Persist conversation to history
        await Promise.all([
            query('INSERT INTO chat_history (live_id, session_key, role, content) VALUES ($1, $2, $3, $4)', [liveId, sessionKey, 'user', userMessage]),
            query('INSERT INTO chat_history (live_id, session_key, role, content) VALUES ($1, $2, $3, $4)', [liveId, sessionKey, 'assistant', fullText])
        ]).catch(e => logger.warn(`Failed to persist chat history for live ${liveId}: ${e.message}`));

        await query(
            `DELETE FROM chat_history
             WHERE live_id = $1
               AND session_key = $2
               AND id IN (
                   SELECT id
                   FROM chat_history
                   WHERE live_id = $1
                     AND session_key = $2
                   ORDER BY created_at DESC, id DESC
                   OFFSET $3
               )`,
            [liveId, sessionKey, MEMORY_MESSAGE_LIMIT]
        ).catch(e => logger.warn(`Failed to prune chat history for live ${liveId}: ${e.message}`));

        return fullText;

    } catch (e: any) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.error(`Orchestrator error for live ${liveId}: ${err.message}`, {
            name: err.name,
            stack: err.stack,
            cause: (err as any).cause,
            code: (err as any).code
        });
        onError?.(err);
        throw err;
    }
}

