// Copyright (c) 2026 Flavio Cerato
import https from 'https';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import { toolRegistry } from './toolRegistry.js';

logger.info('tavilyTools module loaded');

async function getTavilyApiKey(): Promise<string> {
    const res = await query("SELECT ciphertext FROM secrets WHERE key='tavily.api_key'");
    if (!res.rows.length) {
        throw new Error('Tavily API key not configured. Add it in the Tavily connector settings.');
    }
    return JSON.parse(decrypt(res.rows[0].ciphertext as string));
}

function postJson(url: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const parsed = new URL(url);
        const req = https.request(
            {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
                timeout: 30_000,
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk.toString(); });
                res.on('end', () => {
                    if (!raw) { resolve({}); return; }
                    let parsed: any;
                    try {
                        parsed = JSON.parse(raw);
                    } catch {
                        reject(new Error(`Non-JSON response from Tavily (${res.statusCode}): ${raw.slice(0, 200)}`));
                        return;
                    }
                    if ((res.statusCode || 500) >= 400) {
                        const detail = parsed?.detail || parsed?.error?.message || `HTTP ${res.statusCode}`;
                        reject(new Error(`Tavily API error: ${detail}`));
                        return;
                    }
                    resolve(parsed);
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Tavily request timed out')); });
        req.write(bodyStr);
        req.end();
    });
}

toolRegistry.register({
    name: 'tavily.search',
    description: 'Perform an AI-powered web search via Tavily. Returns relevant results with titles, URLs, extracted content, and an optional summary answer. Preferred over DuckDuckGo for searches requiring in-depth content or authoritative sources.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The search query',
            },
            search_depth: {
                type: 'string',
                enum: ['basic', 'advanced'],
                description: "Search depth: 'basic' (fast, default) or 'advanced' (more accurate, recommended for in-depth searches)",
                default: 'basic',
            },
            max_results: {
                type: 'number',
                description: 'Maximum number of results to return (1-10, default 5)',
                default: 5,
            },
            include_answer: {
                type: 'boolean',
                description: 'If true, includes an AI-generated summary answer based on the results (default true)',
                default: true,
            },
            include_domains: {
                type: 'array',
                items: { type: 'string' },
                description: "Optional list of domains to include in the search (e.g. ['wikipedia.org', 'bbc.com'])",
            },
            exclude_domains: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of domains to exclude from the search',
            },
        },
        required: ['query'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const apiKey = await getTavilyApiKey();
        const maxResults = Math.min(Math.max(Number(input.max_results) || 5, 1), 10);
        const searchDepth = input.search_depth === 'advanced' ? 'advanced' : 'basic';

        logger.info(`Tavily search: "${input.query}" (depth=${searchDepth}, max=${maxResults})`);

        const body: any = {
            api_key: apiKey,
            query: input.query,
            search_depth: searchDepth,
            max_results: maxResults,
            include_answer: input.include_answer !== false,
        };

        if (Array.isArray(input.include_domains) && input.include_domains.length > 0) {
            body.include_domains = input.include_domains;
        }
        if (Array.isArray(input.exclude_domains) && input.exclude_domains.length > 0) {
            body.exclude_domains = input.exclude_domains;
        }

        const result = await postJson('https://api.tavily.com/search', body);

        return {
            query: result.query,
            answer: result.answer ?? null,
            results: (result.results || []).map((r: any) => ({
                title: r.title,
                url: r.url,
                content: r.content,
                score: r.score,
                published_date: r.published_date ?? null,
            })),
        };
    },
});

toolRegistry.register({
    name: 'tavily.extract',
    description: 'Extract text content from one or more URLs via Tavily. Useful for reading the full text of articles, web pages, or documentation found previously.',
    inputSchema: {
        type: 'object',
        properties: {
            urls: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of URLs to extract content from (max 5)',
            },
        },
        required: ['urls'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const apiKey = await getTavilyApiKey();
        const urls = (input.urls as string[]).slice(0, 5);

        logger.info(`Tavily extract: ${urls.length} URL(s): ${urls.join(', ')}`);

        const result = await postJson('https://api.tavily.com/extract', {
            api_key: apiKey,
            urls,
        });

        return {
            results: (result.results || []).map((r: any) => ({
                url: r.url,
                raw_content: r.raw_content,
            })),
            failed_results: result.failed_results || [],
        };
    },
});
