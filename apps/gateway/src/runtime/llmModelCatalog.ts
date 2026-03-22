import OpenAI from 'openai';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';

type Provider = 'openai' | 'google' | 'anthropic' | string;

type ResolvedConfig = {
    provider: Provider;
    baseURL?: string;
    apiKey?: string;
};

export type LlmModelOption = {
    id: string;
    label: string;
};

export type LlmModelListResult = {
    provider: Provider;
    models: LlmModelOption[];
    defaultModel: string;
    source: 'remote' | 'fallback';
};

const FALLBACK_MODELS: Record<string, string[]> = {
    openai: [
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.2',
        'gpt-5-mini',
        'gpt-5-nano',
        'gpt-4o',
        'gpt-4o-mini',
        'o1-preview',
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'qwen/qwen3-32b',
        'moonshotai/kimi-k2-instruct-0905',
        'gemma-3-27b-it',
    ],
    google: [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-flash-latest',
        'gemini-pro-latest',
    ],
    anthropic: [
        'claude-sonnet-4-5',
        'claude-opus-4-1',
        'claude-3-7-sonnet-latest',
    ],
};

const PROVIDER_DEFAULTS: Record<string, string> = {
    openai: 'gpt-4o-mini',
    google: 'gemini-2.5-flash',
    anthropic: 'claude-3-7-sonnet-latest',
};

function normalizeProvider(provider?: string | null): Provider {
    return (provider || 'openai').toLowerCase();
}

function normalizeModelId(provider: Provider, modelId: string): string {
    const trimmed = modelId.trim();
    if (provider === 'google' && trimmed.startsWith('models/')) {
        return trimmed.slice('models/'.length);
    }
    return trimmed;
}

function toOptions(provider: Provider, modelIds: string[]): LlmModelOption[] {
    return Array.from(new Set(modelIds.map((id) => normalizeModelId(provider, id)).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, label: id }));
}

async function readDefaultOpenAIKey(): Promise<string | undefined> {
    if (process.env.OPENAI_API_KEY) {
        return process.env.OPENAI_API_KEY;
    }

    const res = await query("SELECT ciphertext FROM secrets WHERE key='openai.api_key'");
    if (!res.rows.length) {
        return undefined;
    }

    return JSON.parse(decrypt(res.rows[0].ciphertext as string));
}

async function resolveConfig(llmConfigId?: string | null): Promise<ResolvedConfig> {
    if (!llmConfigId) {
        return {
            provider: 'openai',
            baseURL: process.env.OPENAI_BASE_URL,
            apiKey: await readDefaultOpenAIKey(),
        };
    }

    const res = await query(
        'SELECT provider, base_url, api_key_cipher FROM llm_configs WHERE id = $1',
        [llmConfigId]
    );

    if (!res.rows.length) {
        return {
            provider: 'openai',
            baseURL: process.env.OPENAI_BASE_URL,
            apiKey: await readDefaultOpenAIKey(),
        };
    }

    const row = res.rows[0];
    const provider = normalizeProvider(row.provider);
    const apiKey = row.api_key_cipher
        ? JSON.parse(decrypt(row.api_key_cipher as string))
        : undefined;

    let baseURL = row.base_url || process.env.OPENAI_BASE_URL;
    if (provider === 'google' && !row.base_url) {
        baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    }

    return { provider, baseURL, apiKey };
}

async function fetchRemoteModels(config: ResolvedConfig): Promise<LlmModelOption[]> {
    if (!config.apiKey) {
        return [];
    }

    const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
    });

    const response = await client.models.list();
    const ids = response.data
        .map((model) => typeof model.id === 'string' ? model.id : '')
        .filter(Boolean);

    return toOptions(config.provider, ids);
}

export async function listLlmModels(llmConfigId?: string | null): Promise<LlmModelListResult> {
    const config = await resolveConfig(llmConfigId);
    const fallback = toOptions(config.provider, FALLBACK_MODELS[config.provider] || FALLBACK_MODELS.openai);
    const defaultModel = PROVIDER_DEFAULTS[config.provider] || PROVIDER_DEFAULTS.openai;

    try {
        const remoteModels = await fetchRemoteModels(config);
        if (remoteModels.length > 0) {
            return {
                provider: config.provider,
                models: remoteModels,
                defaultModel,
                source: 'remote',
            };
        }
    } catch (error: any) {
        logger.warn(`Failed to load remote LLM models for provider ${config.provider}: ${error.message}`);
    }

    return {
        provider: config.provider,
        models: fallback,
        defaultModel,
        source: 'fallback',
    };
}
