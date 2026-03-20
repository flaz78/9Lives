// Copyright (c) 2026 Flavio Cerato
﻿import http from 'http';
import https from 'https';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import { toolRegistry } from './toolRegistry.js';

type WebhookConfig = {
    id: string;
    name: string;
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    apiKey: string;
    bodyTemplate?: any;
};

logger.info('webhookTools module loaded');

async function getWebhookConfigs(): Promise<WebhookConfig[]> {
    const res = await query("SELECT ciphertext FROM secrets WHERE key='webhooks.configs'");
    if (!res.rows.length) {
        return [];
    }

    try {
        const value = JSON.parse(decrypt(res.rows[0].ciphertext as string));
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

async function getAllowedWebhookIdsForLive(liveId: string): Promise<string[] | null> {
    try {
        const res = await query('SELECT webhook_ids FROM lives WHERE id=$1', [liveId]);
        if (!res.rows.length) return null;
        const raw = res.rows[0].webhook_ids;
        if (!Array.isArray(raw)) return null;
        const ids = raw.filter((item: any) => typeof item === 'string').map((item: string) => item.trim()).filter(Boolean);
        return ids;
    } catch {
        // Backward compatibility when column is not migrated yet
        return null;
    }
}

function buildRequestBody(config: WebhookConfig, body: any) {
    if (body !== undefined) {
        if (config.bodyTemplate && typeof config.bodyTemplate === 'object' && !Array.isArray(config.bodyTemplate) && typeof body === 'object' && body !== null && !Array.isArray(body)) {
            return { ...config.bodyTemplate, ...body };
        }
        return body;
    }
    return config.bodyTemplate;
}

function requestWebhook(config: WebhookConfig, body?: any, extraHeaders?: Record<string, string>) {
    return new Promise<any>((resolve, reject) => {
        const url = new URL(config.url);
        const isJsonBody = body !== undefined && body !== null;
        const payload = isJsonBody
            ? (typeof body === 'string' ? body : JSON.stringify(body))
            : undefined;

        const headers: Record<string, string> = {
            'x-api-key': config.apiKey,
            ...(extraHeaders || {})
        };

        if (payload !== undefined && !headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
        }
        if (payload !== undefined) {
            headers['Content-Length'] = Buffer.byteLength(payload).toString();
        }

        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
            method: config.method,
            headers,
            timeout: 15000
        }, (res) => {
            let raw = '';
            res.on('data', (chunk) => raw += chunk.toString());
            res.on('end', () => {
                let parsed: any = raw;
                try {
                    parsed = raw ? JSON.parse(raw) : null;
                } catch {
                    // Keep raw text as-is
                }

                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Webhook request timed out'));
        });

        if (payload !== undefined) {
            req.write(payload);
        }

        req.end();
    });
}

toolRegistry.register({
    name: 'webhook.call',
    description: 'Call a webhook configured in Connectors using the saved URL, method, and API key',
    inputSchema: {
        type: 'object',
        properties: {
            webhookId: { type: 'string', description: "ID of the configured webhook" },
            body: { description: 'Payload to send to the webhook for POST/PUT/PATCH. If omitted, uses the connector bodyTemplate if present.' },
            headers: {
                type: 'object',
                description: 'Optional additional headers to send'
            }
        },
        required: ['webhookId']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const configs = await getWebhookConfigs();
        const config = configs.find((item) => item?.id === input.webhookId);

        if (!config) {
            throw new Error(`Webhook not found: ${input.webhookId}`);
        }

        const allowedIds = await getAllowedWebhookIdsForLive(ctx.liveId);
        if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(config.id)) {
            throw new Error(`Webhook ${config.id} not allowed for live ${ctx.liveId}`);
        }

        const requestBody = buildRequestBody(config, input.body);

        logger.info(`Calling webhook ${config.id} (${config.method} ${config.url})`);

        const result = await requestWebhook(config, requestBody, input.headers);

        return {
            webhookId: config.id,
            name: config.name,
            method: config.method,
            url: config.url,
            bodyTemplateApplied: input.body === undefined && config.bodyTemplate !== undefined,
            ...result
        };
    }
});
