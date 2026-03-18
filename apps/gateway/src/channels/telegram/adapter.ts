// Copyright (c) 2026 Flavio Cerato
import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { query } from '../../storage/pg/pool.js';
import { decrypt } from '../../util/crypto.js';
import { runLive } from '../../runtime/orchestrator.js';
import { runCrew } from '../../runtime/crewOrchestrator.js';
import { routeTargetForIncomingMessage } from '../../runtime/channelRouter.js';
import { logger } from '../../util/logger.js';
import type { WebSocketServer } from 'ws';
import { toolRegistry } from '../../runtime/toolRegistry.js';

// ── Telegram message limit ────────────────────────────────────────────────
const TG_MAX = 4000; // Telegram limit is 4096, use 4000 for safety
const TELEGRAM_UPLOADS_DIR = process.env.TELEGRAM_UPLOADS_DIR ?? path.join(process.cwd(), 'workspace/storage/telegram_uploads');

type TelegramAttachment = {
    kind: 'photo' | 'document';
    fileId: string;
    fileName: string;
    mimeType: string;
    fileSize?: number;
    path: string;
};

/**
 * Splits a long text into chunks ≤ maxLen characters.
 * Tries to break at paragraph boundaries, then at newlines, then hard-cuts.
 */
function splitMessage(text: string, maxLen = TG_MAX): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLen) {
        let cut = maxLen;

        // Try paragraph boundary (double newline)
        const paraBreak = remaining.lastIndexOf('\n\n', maxLen);
        if (paraBreak > maxLen / 2) {
            cut = paraBreak + 2;
        } else {
            // Try single newline
            const lineBreak = remaining.lastIndexOf('\n', maxLen);
            if (lineBreak > maxLen / 2) {
                cut = lineBreak + 1;
            } else {
                // Try space
                const spaceBreak = remaining.lastIndexOf(' ', maxLen);
                if (spaceBreak > maxLen / 2) cut = spaceBreak + 1;
            }
        }

        chunks.push(remaining.slice(0, cut).trimEnd());
        remaining = remaining.slice(cut).trimStart();
    }

    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}

/**
 * Sends a (possibly long) text to a Telegram chat, splitting into chunks if needed.
 * Tries Markdown first, falls back to plain text on parse error.
 */
async function sendTelegramText(bot: TelegramBot, chatId: string, text: string): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
        try {
            await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        } catch (e: any) {
            logger.warn(`Telegram sendMessage Markdown error, retrying without formatting: ${e.message}`);
            await bot.sendMessage(chatId, chunk);
        }
    }
}

function extensionFromMime(mimeType?: string, fallback = '.bin') {
    switch ((mimeType || '').toLowerCase()) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/webp':
            return '.webp';
        case 'image/gif':
            return '.gif';
        case 'application/pdf':
            return '.pdf';
        case 'text/plain':
            return '.txt';
        case 'application/json':
            return '.json';
        default:
            return fallback;
    }
}

function safeFileName(fileName: string) {
    return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

async function downloadTelegramFile(url: string, targetPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    await new Promise<void>((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const req = client.get(url, (res) => {
            if ((res.statusCode || 500) >= 300 && (res.statusCode || 500) < 400 && res.headers.location) {
                const nextUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                res.resume();
                downloadTelegramFile(nextUrl, targetPath).then(resolve).catch(reject);
                return;
            }

            if ((res.statusCode || 500) >= 400) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} while downloading Telegram file`));
                return;
            }

            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', async () => {
                try {
                    await fs.writeFile(targetPath, Buffer.concat(chunks));
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Telegram file download timed out'));
        });
        req.setTimeout(15000);
    });
}

async function collectTelegramAttachments(bot: TelegramBot, msg: any, botId: string, chatId: string): Promise<TelegramAttachment[]> {
    const attachments: TelegramAttachment[] = [];
    const stamp = Date.now();

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1];
        if (photo?.file_id) {
            const fileId = photo.file_id;
            const fileName = `${botId}_${chatId}_${stamp}_${fileId}${extensionFromMime('image/jpeg', '.jpg')}`;
            const filePath = path.join(TELEGRAM_UPLOADS_DIR, safeFileName(fileName));
            const url = await bot.getFileLink(fileId);
            await downloadTelegramFile(url, filePath);
            attachments.push({
                kind: 'photo',
                fileId,
                fileName,
                mimeType: 'image/jpeg',
                fileSize: photo.file_size,
                path: filePath
            });
        }
    }

    if (msg.document?.file_id) {
        const document = msg.document;
        const fileId = document.file_id;
        const originalName = document.file_name || `${botId}_${chatId}_${stamp}_${fileId}${extensionFromMime(document.mime_type)}`;
        const fileName = safeFileName(originalName);
        const filePath = path.join(TELEGRAM_UPLOADS_DIR, fileName);
        const url = await bot.getFileLink(fileId);
        await downloadTelegramFile(url, filePath);
        attachments.push({
            kind: 'document',
            fileId,
            fileName,
            mimeType: document.mime_type || 'application/octet-stream',
            fileSize: document.file_size,
            path: filePath
        });
    }

    return attachments;
}

function buildTelegramUserMessage(text: string, attachments: TelegramAttachment[]) {
    const trimmed = text.trim();
    if (attachments.length === 0) return trimmed;

    const summary = attachments
        .map((item) => `- ${item.kind}: ${item.fileName} (${item.mimeType}) at ${item.path}`)
        .join('\n');

    const header = "L'utente ha inviato allegati Telegram.";
    return trimmed ? `${trimmed}\n\n${header}\n${summary}` : `${header}\n${summary}`;
}

let bots: Map<string, TelegramBot> = new Map();

// Register tools
toolRegistry.register({
    name: 'telegram.sendMessage',
    description: 'Send a message to a Telegram chat through one of the configured bots',
    inputSchema: {
        type: 'object',
        properties: {
            botId: { type: 'string', description: 'ID del bot Telegram da utilizzare' },
            chatId: { type: 'string', description: 'ID della chat o destinatario' },
            text: { type: 'string', description: 'Message text' },
        },
        required: ['botId', 'chatId', 'text'],
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const bot = bots.get(input.botId);
        if (!bot) throw new Error(`Telegram bot ${input.botId} non trovato o non inizializzato`);
        if (!input.text || input.text.trim().length === 0) {
            logger.warn(`Telegram tool sendMessage called with empty text for bot ${input.botId}, chat ${input.chatId}`);
            return { success: false, message: 'Cannot send empty message' };
        }
        await sendTelegramText(bot, input.chatId, input.text);
        return { success: true };
    }
});

export async function startTelegramAdapter(wss: WebSocketServer) {
    try {
        const res = await query("SELECT ciphertext FROM secrets WHERE key='telegram.bots'");
        if (!res.rows.length) {
            logger.info('Telegram: no bots configured, adapter not started.');
            return;
        }

        let botsConfig: any[] = [];
        try { botsConfig = JSON.parse(decrypt(res.rows[0].ciphertext as any)); } catch { }

        // Stop previous instances
        for (const [id, b] of bots.entries()) {
            try { b.stopPolling(); } catch { }
        }
        bots.clear();

        for (const config of botsConfig) {
            if (!config.id || !config.token) continue;

            const bot = new TelegramBot(config.token, { polling: true });
            bots.set(config.id, bot);
            logger.info(`Telegram adapter started for bot ${config.id} (${config.name})`);

            const whitelist: string[] = config.whitelist
                ? config.whitelist.split(/[,\s]+/).filter((s: string) => s.trim().length > 0)
                : [];

            bot.on('message', async (msg: any) => {
                // DEBUG: Reload whitelist from DB to be absolutely sure it's fresh
                let currentWhitelist: string[] = whitelist;
                try {
                    const freshRes = await query("SELECT ciphertext FROM secrets WHERE key='telegram.bots'");
                    if (freshRes.rows.length > 0) {
                        const allBots = JSON.parse(decrypt(freshRes.rows[0].ciphertext as any));
                        const myBot = allBots.find((b: any) => b.id === config.id);
                        if (myBot && myBot.whitelist) {
                            currentWhitelist = myBot.whitelist.split(/[,\s]+/).filter((s: string) => s.trim().length > 0);
                        }
                    }
                } catch (e) {
                    logger.error(`Error reloading whitelist for ${config.id}:`, e);
                }

                const chatId = msg.chat.id.toString();
                const text = msg.text ?? msg.caption ?? '';
                let attachments: TelegramAttachment[] = [];

                // Whitelist check
                if (currentWhitelist.length > 0) {
                    const fromId = msg.from?.id?.toString();
                    const fromUsername = msg.from?.username?.toLowerCase();

                    logger.info(`[WHITELIST DEBUG] Bot: ${config.id} | User: ${fromId} (${fromUsername}) | Raw Whitelist: [${currentWhitelist.join('|')}]`);

                    const isAllowed = currentWhitelist.some(item => {
                        const normalized = item.trim().toLowerCase();
                        const cleanItem = normalized.startsWith('@') ? normalized.substring(1) : normalized;
                        const match = normalized === fromId || (fromUsername && cleanItem === fromUsername);

                        logger.info(`  Check item: "${item}" -> normalized: "${normalized}", clean: "${cleanItem}" | Result: ${match}`);
                        return match;
                    });

                    if (!isAllowed) {
                        const displayUsername = msg.from?.username ? `@${msg.from.username}` : 'no username';
                        logger.warn(`Telegram (${config.id}): blocked message from unauthorized user ${fromId} (${displayUsername})`);
                        // Explicitly notify user why they are blocked if not allowed
                        bot.sendMessage(chatId, "Spiacente, non sei autorizzato a usare questo bot (Whitelist check fallito).");
                        return;
                    }
                }

                if (text.startsWith('/')) {
                    if (text === '/start') {
                        bot.sendMessage(chatId, '👋 Ciao! Sono il tuo 9Lives AI agent. Scrivimi qualcosa!');
                    }
                    return;
                }

                try {
                    attachments = await collectTelegramAttachments(bot, msg, config.id, chatId);
                } catch (e: any) {
                    logger.error(`Telegram attachment download failed on bot ${config.id}: ${e.message}`);
                    await bot.sendMessage(chatId, `❌ Errore nel download dell'allegato: ${e.message}`).catch(() => { });
                    return;
                }

                const userMessage = buildTelegramUserMessage(text, attachments);
                if (!userMessage) {
                    return;
                }

                logger.info(`Telegram message from ${chatId} on bot ${config.id}: ${userMessage.substring(0, 80)}`);

                // Find a live that has this specific channel configured
                const routed = await routeTargetForIncomingMessage(`telegram:${config.id}`, userMessage);
                // Route across all lives attached to this Telegram bot
                if (!routed) {
                    bot.sendMessage(chatId, '⚠️ Nessun Live configurato per questo canale o come default.');
                    return;
                }
                const finalUserMessage = routed.cleanedMessage;
                const targetLabel = `${routed.kind} ${routed.id}`;
                logger.info(`Telegram routing selected ${targetLabel} for bot ${config.id} (reason: ${routed.reason})`);
                const sessionKey = `telegram:${routed.kind}:${routed.id}:${config.id}:${chatId}`;

                // Typing indicator
                bot.sendChatAction(chatId, 'typing');

                let fullText = '';
                try {
                    const baseRunOptions = {
                        sessionKey,
                        userMessage: finalUserMessage,
                        channelContext: { chatId, botId: config.id, attachments },
                        onDelta: (delta: string) => { fullText += delta; },
                        onDone: async (text: string) => {
                            if (!text || text.trim().length === 0) {
                                logger.warn(`Telegram onDone: received empty text from orchestrator for ${targetLabel}`);
                                return;
                            }
                            await sendTelegramText(bot, chatId, text);
                            // Broadcast to UI
                            broadcast(wss, 'chat.message', {
                                sessionKey,
                                role: 'assistant',
                                content: text,
                                channel: `telegram:${config.id}`,
                                chatId,
                            });
                        },
                        onError: async (err: any) => {
                            // @ts-ignore legacy callback typing
                            await bot.sendMessage(chatId, `❌ Errore: ${err.message}`).catch(e => logger.error(`Telegram onError sendMessage failed: ${e.message}`));
                        },
                    };
                    if (routed.kind === 'crew') {
                        await runCrew({
                            crewId: routed.id,
                            ...baseRunOptions,
                        });
                    } else {
                        await runLive({
                            liveId: routed.id,
                            ...baseRunOptions,
                        });
                    }
                } catch (e: any) {
                    bot.sendMessage(chatId, `❌ ${e.message}`).catch(() => { });
                }
            });

            bot.on('polling_error', (err: any) => {
                logger.error(`Telegram polling error on bot ${config.id}:`, err.message);
            });
        }
    } catch (e: any) {
        logger.error('Failed to start Telegram adapter:', e.message);
    }
}

export async function stopTelegramAdapter() {
    for (const [id, b] of bots.entries()) {
        try { b.stopPolling(); } catch { }
    }
    bots.clear();
    logger.info('Telegram adapter stopped');
}

function broadcast(wss: WebSocketServer, event: string, payload: any) {
    const frame = JSON.stringify({ type: 'event', event, payload });
    wss.clients.forEach((client: any) => {
        if (client.readyState === 1) client.send(frame);
    });
}
