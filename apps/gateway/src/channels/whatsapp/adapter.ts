// Copyright (c) 2026 Flavio Cerato
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    proto,
    downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { query } from '../../storage/pg/pool.js';
import { decrypt, encrypt } from '../../util/crypto.js';
import { runLive } from '../../runtime/orchestrator.js';
import { runCrew } from '../../runtime/crewOrchestrator.js';
import { routeTargetForIncomingMessage } from '../../runtime/channelRouter.js';
import { logger } from '../../util/logger.js';
import { toolRegistry } from '../../runtime/toolRegistry.js';
import type { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';

// ── Module state ──────────────────────────────────────────────────────────

let sock: WASocket | null = null;
let wssRef: WebSocketServer | null = null;
let lastQR: string | null = null;          // data URL of current QR
let connectionStatus: 'disconnected' | 'connecting' | 'qr' | 'connected' = 'disconnected';

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? '/data/whatsapp_auth';
const WHATSAPP_UPLOADS_DIR = process.env.WHATSAPP_UPLOADS_DIR ?? path.join(process.cwd(), 'workspace/storage/whatsapp_uploads');

type WhatsAppAttachment = {
    kind: 'image' | 'document';
    fileName: string;
    mimeType: string;
    fileSize?: number | null;
    path: string;
};

// Baileys expects a pino-like logger with `.child()`.
const baileysLogger: any = {
    level: 'silent',
    child: () => baileysLogger,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
};

// ── Tool: whatsapp.sendMessage ────────────────────────────────────────────

toolRegistry.register({
    name:        'whatsapp.sendMessage',
    description: 'Send a WhatsApp message to a number/JID',
    inputSchema: {
        type: 'object',
        properties: {
            to:   { type: 'string', description: "JID destinatario (es: 3912345678@s.whatsapp.net) o numero con prefisso internazionale" },
            text: { type: 'string', description: "Testo del messaggio" },
        },
        required: ['to', 'text'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        if (!sock) throw new Error('WhatsApp non connesso. Scansiona il QR nel pannello Connectors.');
        let jid = input.to.trim();
        // Normalize: se non contiene @, aggiungi @s.whatsapp.net
        if (!jid.includes('@')) {
            jid = jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        if (!input.text || input.text.trim().length === 0) {
            return { success: false, message: 'Impossibile inviare messaggio vuoto.' };
        }
        await sock.sendMessage(jid, { text: input.text });
        return { success: true, jid };
    },
});

// ── Tool: whatsapp.getStatus ──────────────────────────────────────────────

toolRegistry.register({
    name:        'whatsapp.getStatus',
    description: 'Check WhatsApp connection status',
    inputSchema: { type: 'object', properties: {} },
    sideEffecting: false,
    handler: async () => {
        return {
            connected: connectionStatus === 'connected',
            status:    connectionStatus,
            hasQR:     !!lastQR,
        };
    },
});

// ── Whitelist helper ──────────────────────────────────────────────────────

async function loadWhitelist(): Promise<string[]> {
    try {
        const res = await query("SELECT ciphertext FROM secrets WHERE key='whatsapp.whitelist'");
        if (!res.rows.length) return [];
        const raw = JSON.parse(decrypt(res.rows[0].ciphertext));
        if (typeof raw === 'string') {
            return raw.split(/[,\s]+/).filter((s: string) => s.trim().length > 0);
        }
        if (Array.isArray(raw)) return raw;
        return [];
    } catch {
        return [];
    }
}

function normalizePhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
}

function isAllowed(senderJid: string, whitelist: string[]): boolean {
    if (whitelist.length === 0) return true; // nessun filtro → tutti consentiti
    const senderNum = normalizePhone(senderJid.split('@')[0]);
    return whitelist.some(w => normalizePhone(w) === senderNum);
}

// ── Connection management ─────────────────────────────────────────────────

function extensionFromMime(mimeType?: string, fallback = '.bin'): string {
    switch ((mimeType || '').toLowerCase()) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/webp':
            return '.webp';
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

function safeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

async function streamToBuffer(stream: AsyncIterable<Buffer | Uint8Array>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function collectWhatsAppAttachments(msg: proto.IWebMessageInfo, senderJid: string): Promise<WhatsAppAttachment[]> {
    const m: any = msg.message;
    if (!m) return [];

    const attachments: WhatsAppAttachment[] = [];
    const stamp = Date.now();
    const senderNum = normalizePhone(senderJid.split('@')[0]);

    const imageMessage = m.imageMessage ?? m.viewOnceMessageV2?.message?.imageMessage;
    if (imageMessage) {
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        const buffer = await streamToBuffer(stream);
        const fileName = safeFileName(`${senderNum}_${stamp}${extensionFromMime(imageMessage.mimetype, '.jpg')}`);
        const filePath = path.join(WHATSAPP_UPLOADS_DIR, fileName);
        fs.mkdirSync(WHATSAPP_UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(filePath, buffer);
        attachments.push({
            kind: 'image',
            fileName,
            mimeType: imageMessage.mimetype || 'image/jpeg',
            fileSize: imageMessage.fileLength ? Number(imageMessage.fileLength) : buffer.length,
            path: filePath
        });
    }

    const documentMessage = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
    if (documentMessage) {
        const stream = await downloadContentFromMessage(documentMessage, 'document');
        const buffer = await streamToBuffer(stream);
        const originalName = documentMessage.fileName || `${senderNum}_${stamp}${extensionFromMime(documentMessage.mimetype)}`;
        const fileName = safeFileName(originalName);
        const filePath = path.join(WHATSAPP_UPLOADS_DIR, fileName);
        fs.mkdirSync(WHATSAPP_UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(filePath, buffer);
        attachments.push({
            kind: 'document',
            fileName,
            mimeType: documentMessage.mimetype || 'application/octet-stream',
            fileSize: documentMessage.fileLength ? Number(documentMessage.fileLength) : buffer.length,
            path: filePath
        });
    }

    return attachments;
}

function buildWhatsAppUserMessage(text: string | null, attachments: WhatsAppAttachment[]): string {
    const trimmed = (text || '').trim();
    if (attachments.length === 0) return trimmed;

    const summary = attachments
        .map((item) => `- ${item.kind}: ${item.fileName} (${item.mimeType}) at ${item.path}`)
        .join('\n');

    const header = "L'utente ha inviato allegati WhatsApp.";
    return trimmed ? `${trimmed}\n\n${header}\n${summary}` : `${header}\n${summary}`;
}

export async function startWhatsAppAdapter(wss: WebSocketServer) {
    wssRef = wss;
    logger.info('WhatsApp adapter initializing...');

    // Ensure auth dir exists
    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    await connectWhatsApp();
}

async function connectWhatsApp() {
    connectionStatus = 'connecting';
    lastQR = null;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        printQRInTerminal: true,
        logger: baileysLogger,
        generateHighQualityLinkPreview: false,
    });

    const s = sock;
    if (!s) {
        connectionStatus = 'disconnected';
        logger.error('WhatsApp: socket init failed');
        return;
    }

    // ── Connection events ────────────────────────────────────────────────
    s.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // Genera QR come data URL e broadcast alla UI
            lastQR = await QRCode.toDataURL(qr);
            connectionStatus = 'qr';
            broadcast('whatsapp.qr', { qr: lastQR });
            logger.info('WhatsApp: QR code generato, in attesa di scansione...');
        }

        if (connection === 'close') {
            connectionStatus = 'disconnected';
            lastQR = null;
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const loggedOut = reason === DisconnectReason.loggedOut;

            if (loggedOut) {
                logger.warn('WhatsApp: logged out, rimuovo sessione...');
                // Pulisci auth dir
                try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
                broadcast('whatsapp.status', { status: 'disconnected', reason: 'logged_out' });
            } else {
                logger.info(`WhatsApp: disconnesso (motivo: ${reason}), riconnessione...`);
                broadcast('whatsapp.status', { status: 'reconnecting' });
                setTimeout(() => connectWhatsApp(), 3000);
            }
        }

        if (connection === 'open') {
            connectionStatus = 'connected';
            lastQR = null;
            const me = s.user;
            logger.info(`WhatsApp: connesso come ${me?.id ?? 'unknown'} (${me?.name ?? ''})`);
            broadcast('whatsapp.status', { status: 'connected', user: me?.id, name: me?.name });
        }
    });

    // ── Save credentials on update ───────────────────────────────────────
    s.ev.on('creds.update', saveCreds);

    // ── Incoming messages ────────────────────────────────────────────────
    s.ev.on('messages.upsert', async ({ messages, type }) => {
        const liveSock = sock;
        if (!liveSock) return;
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignora messaggi propri, di stato e di gruppo (opzionale)
            if (msg.key.fromMe) continue;
            if (msg.key.remoteJid === 'status@broadcast') continue;

            const senderJid = msg.key.remoteJid ?? '';
            const isGroup   = senderJid.endsWith('@g.us');
            const text = extractText(msg);
            let attachments: WhatsAppAttachment[] = [];

            try {
                attachments = await collectWhatsAppAttachments(msg, senderJid);
            } catch (e: any) {
                logger.error(`WhatsApp attachment download failed from ${senderJid}: ${e.message}`);
                await liveSock.sendMessage(senderJid, { text: `❌ Errore nel download dell'allegato: ${e.message}` }).catch(() => {});
                continue;
            }

            const userMessage = buildWhatsAppUserMessage(text, attachments);
            if (!userMessage) continue;

            logger.info(`WhatsApp message from ${senderJid}${isGroup ? ' (gruppo)' : ''}: ${userMessage.substring(0, 80)}`);

            // Whitelist check (solo per chat private)
            if (!isGroup) {
                const whitelist = await loadWhitelist();
                if (!isAllowed(senderJid, whitelist)) {
                    // Ignora silenziosamente — nessuna risposta ai numeri non autorizzati
                    logger.warn(`WhatsApp: messaggio ignorato da ${senderJid} (non in whitelist)`);
                    continue;
                }
            }

            // Routing: trova il Live associato
            const routed = await routeTargetForIncomingMessage('whatsapp', userMessage);
            if (!routed) {
                // Risponde solo se il mittente è whitelisted (o whitelist vuota)
                logger.warn(`WhatsApp: nessun Live configurato per messaggio da ${senderJid}`);
                continue;
            }

            const finalUserMessage = routed.cleanedMessage;
            const targetLabel = `${routed.kind} ${routed.id}`;
            logger.info(`WhatsApp routing selected ${targetLabel} for ${senderJid} (reason: ${routed.reason})`);
            const sessionKey = `whatsapp:${routed.kind}:${routed.id}:${senderJid}`;

            // Typing indicator
            await liveSock.presenceSubscribe(senderJid);
            await liveSock.sendPresenceUpdate('composing', senderJid);

            try {
                const baseRunOptions = {
                    sessionKey,
                    userMessage: finalUserMessage,
                    channelContext: { jid: senderJid, isGroup, pushName: msg.pushName, attachments },
                    onDelta: () => {},
                    onDone: async (reply: string) => {
                        if (!reply || reply.trim().length === 0) return;
                        await liveSock.sendPresenceUpdate('paused', senderJid);
                        await liveSock.sendMessage(senderJid, { text: reply });
                        broadcast('chat.message', {
                            sessionKey,
                            role:    'assistant',
                            content: reply,
                            channel: 'whatsapp',
                            chatId:  senderJid,
                        });
                    },
                    onError: async (err: any) => {
                        await liveSock.sendPresenceUpdate('paused', senderJid);
                        await liveSock.sendMessage(senderJid, { text: `❌ Errore: ${err.message}` }).catch(() => {});
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
                await liveSock.sendMessage(senderJid, { text: `❌ ${e.message}` }).catch(() => {});
            }
        }
    });
}

// ── Text extraction ───────────────────────────────────────────────────────

function extractText(msg: proto.IWebMessageInfo): string | null {
    const m = msg.message;
    if (!m) return null;
    return (
        m.conversation ??
        m.extendedTextMessage?.text ??
        m.imageMessage?.caption ??
        m.documentMessage?.caption ??
        (m.documentWithCaptionMessage as any)?.message?.documentMessage?.caption ??
        m.videoMessage?.caption ??
        null
    );
}

// ── Public helpers ────────────────────────────────────────────────────────

export function getWhatsAppQR(): string | null {
    return lastQR;
}

export function getWhatsAppStatus(): string {
    return connectionStatus;
}

export async function stopWhatsAppAdapter() {
    if (sock) {
        sock.end(undefined);
        sock = null;
    }
    connectionStatus = 'disconnected';
    lastQR = null;
    logger.info('WhatsApp adapter stopped');
}

// ── Broadcast to UI ───────────────────────────────────────────────────────

function broadcast(event: string, payload: any) {
    if (!wssRef) return;
    const frame = JSON.stringify({ type: 'event', event, payload });
    wssRef.clients.forEach((client: any) => {
        if (client.readyState === 1) client.send(frame);
    });
}
