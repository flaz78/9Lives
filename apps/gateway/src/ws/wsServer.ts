// Copyright (c) 2026 Flavio Cerato
import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import cron from 'node-cron';
import { logger } from '../util/logger.js';
import type { Frame, RequestFrame } from '@9lives/shared';
import { query } from '../storage/pg/pool.js';
import { encrypt, decrypt } from '../util/crypto.js';

// In-memory session store  
const sessions = new Map<WebSocket, { deviceId: string; deviceName: string; authed: boolean }>();

function send(ws: WebSocket, frame: object) {
    ws.send(JSON.stringify(frame));
}

function ok(ws: WebSocket, id: string, payload: any) {
    send(ws, { type: 'res', id, ok: true, payload });
}

function err(ws: WebSocket, id: string, code: string, message: string) {
    send(ws, { type: 'res', id, ok: false, error: { code, message } });
}

function event(wss: WebSocketServer, name: string, payload: any) {
    wss.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN) {
            send(client, { type: 'event', event: name, payload });
        }
    });
}

function getWsSessionKey(ws: WebSocket, liveId: string) {
    const session = sessions.get(ws);
    const deviceId = session?.deviceId || 'anonymous';
    return `ws:${liveId}:${deviceId}`;
}

function getWsCrewSessionKey(ws: WebSocket, crewId: string) {
    const session = sessions.get(ws);
    const deviceId = session?.deviceId || 'anonymous';
    return `ws:crew:${crewId}:${deviceId}`;
}

export function setupWsServer(server: Server): WebSocketServer {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws: WebSocket) => {
        logger.info('New WS connection');
        sessions.set(ws, { deviceId: '', deviceName: '', authed: false });

        ws.on('message', async (data: Buffer) => {
            try {
                const frame = JSON.parse(data.toString()) as Frame;
                await handleFrame(ws, wss, frame);
            } catch (e: any) {
                logger.error('Frame error', e);
            }
        });

        ws.on('close', () => {
            sessions.delete(ws);
            logger.info('WS connection closed');
        });
    });

    // Heartbeat every 30s
    setInterval(() => {
        event(wss, 'health', { ts: new Date().toISOString() });
    }, 30_000);

    logger.info('WebSocket server ready');
    return wss;
}

async function handleFrame(ws: WebSocket, wss: WebSocketServer, frame: Frame) {
    const token = process.env.GATEWAY_TOKEN ?? 'change_me';

    if (frame.type === 'connect') {
        const { auth, device } = frame.params;
        if (auth.token !== token) {
            send(ws, { type: 'res', id: 'init', ok: false, error: { code: 'AUTH_FAILED', message: 'Invalid token' } });
            ws.close();
            return;
        }
        sessions.set(ws, { deviceId: device.id, deviceName: device.name, authed: true });
        send(ws, { type: 'res', id: 'init', ok: true, payload: { message: 'Connected to 9Lives Gateway' } });
        logger.info(`Device connected: ${device.name}`);
        return;
    }

    if (frame.type !== 'req') return;
    const req = frame as RequestFrame;
    const session = sessions.get(ws);

    if (!session?.authed) {
        err(ws, req.id, 'NOT_AUTHED', 'Not authenticated');
        return;
    }

    try {
        await dispatch(ws, wss, req);
    } catch (e: any) {
        logger.error(`Handler error [${req.method}]`, e);
        err(ws, req.id, 'INTERNAL', e.message ?? 'Internal error');
    }
}

async function dispatch(ws: WebSocket, wss: WebSocketServer, req: RequestFrame) {
    switch (req.method) {

        // ── Health ──────────────────────────────────────────────────
        case 'health.status': {
            let dbOk = true;
            try { await query('SELECT 1'); } catch { dbOk = false; }
            ok(ws, req.id, { uptime: process.uptime(), version: '0.1.0', db: dbOk });
            break;
        }

        // ── Lives ───────────────────────────────────────────────────
        case 'live.list': {
            const res = await query('SELECT * FROM lives ORDER BY created_at DESC');
            logger.info(`live.list returning ${res.rows.length} lives. Example llm_config_id: ${res.rows[0]?.llm_config_id}`);
            ok(ws, req.id, res.rows);
            break;
        }

        case 'live.create': {
            const { id, name, description = '', system_prompt = '', model_provider = 'openai', model_name = 'gpt-4o-mini', skills = [], channels = [], routing_default = false, webhook_ids = [], guardrail = null } = req.params;
            let { llm_config_id } = req.params;
            if (llm_config_id === '') llm_config_id = null;
            const guardrailJson = guardrail && Object.keys(guardrail).length > 0 ? guardrail : null;

            const { writeFile, mkdir } = await import('fs/promises');
            const path = await import('path');
            const livesDir = process.env.LIVES_DIR ?? '/app/workspace/lives';
            await mkdir(livesDir, { recursive: true });
            const filePath = path.join(livesDir, `${id}.live.md`);
            const personality = system_prompt || description;
            const guardrailYaml = guardrailJson ? `\nguardrail: ${JSON.stringify(guardrailJson)}` : '';
            const content = `---\nid: ${id}\nname: "${name}"\ndescription: "${description}"\nmodel:\n  provider: ${model_provider}\n  name: ${model_name}\n  config_id: ${llm_config_id}\nrouting:\n  default: ${routing_default}\nskills: ${JSON.stringify(skills)}\nwebhook_ids: ${JSON.stringify(webhook_ids)}\npolicy:\n  tool_allow: []\n  tool_deny: []\nmemory:\n  mode: workspace_md\n  files: []${guardrailYaml}\n---\n\n# Personality / SOUL\n${personality}\n`;
            await writeFile(filePath, content, 'utf8');
            await query(
                `INSERT INTO lives (id, name, description, file_path, system_prompt, model_provider, model_name, channels, skills, webhook_ids, routing_default, llm_config_id, guardrail)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, system_prompt=$5, model_provider=$6, model_name=$7, channels=$8::jsonb, skills=$9::jsonb, webhook_ids=$10::jsonb, routing_default=$11, llm_config_id=$12, guardrail=$13::jsonb, updated_at=now()`,
                [id, name, description, filePath, personality, model_provider, model_name, JSON.stringify(channels), JSON.stringify(skills), JSON.stringify(webhook_ids || []), routing_default, llm_config_id, guardrailJson ? JSON.stringify(guardrailJson) : null]
            );
            ok(ws, req.id, { id, name, file_path: filePath, skills });
            break;
        }

        case 'crew.list': {
            const res = await query('SELECT * FROM crews ORDER BY created_at DESC');
            ok(ws, req.id, res.rows);
            break;
        }

        case 'crew.create': {
            const {
                id,
                name,
                description = '',
                system_prompt = '',
                channels = [],
                member_live_ids = [],
                routing_default = false,
                orchestration_mode = 'router_only',
                model_name = 'gpt-5-mini'
            } = req.params;
            let { llm_config_id } = req.params;
            if (llm_config_id === '') llm_config_id = null;

            await query(
                `INSERT INTO crews (id, name, description, system_prompt, channels, member_live_ids, routing_default, orchestration_mode, llm_config_id, model_name)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
                 ON CONFLICT (id) DO UPDATE SET
                    name = $2,
                    description = $3,
                    system_prompt = $4,
                    channels = $5::jsonb,
                    member_live_ids = $6::jsonb,
                    routing_default = $7,
                    orchestration_mode = $8,
                    llm_config_id = $9,
                    model_name = $10,
                    updated_at = now()`,
                [id, name, description, system_prompt, JSON.stringify(channels), JSON.stringify(member_live_ids), routing_default, orchestration_mode, llm_config_id, model_name]
            );

            ok(ws, req.id, { id, name });
            break;
        }

        // ── Credentials ─────────────────────────────────────────────
        case 'creds.set': {
            const { key, value } = req.params;
            if (!key || value === undefined) {
                err(ws, req.id, 'INVALID_PARAMS', 'key and value required');
                break;
            }
            const cipher = encrypt(JSON.stringify(value));
            await query(
                'INSERT INTO secrets (key, ciphertext) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET ciphertext=$2, updated_at=now()',
                [key, cipher]
            );
            // Reload Telegram polling bots when bot config changes from UI.
            if (key === 'telegram.bots') {
                try {
                    const { stopTelegramAdapter, startTelegramAdapter } = await import('../channels/telegram/adapter.js');
                    await stopTelegramAdapter();
                    await startTelegramAdapter(wss);
                    logger.info('Telegram adapter reloaded after telegram.bots update');
                } catch (reloadErr: any) {
                    logger.warn('Telegram adapter reload failed after telegram.bots update: ' + (reloadErr?.message ?? String(reloadErr)));
                }
            }
            ok(ws, req.id, { saved: key });
            break;
        }

        case 'creds.list': {
            const res = await query('SELECT key, ciphertext, updated_at FROM secrets ORDER BY key ASC');
            const rows = res.rows.map(r => {
                try {
                    const decrypted = decrypt(r.ciphertext);
                    return {
                        key: r.key,
                        updated_at: r.updated_at,
                        valueDecrypted: JSON.parse(decrypted)
                    };
                } catch (e) {
                    return { key: r.key, updated_at: r.updated_at };
                }
            });
            ok(ws, req.id, rows);
            break;
        }

        case 'creds.get': {
            // Returns decrypted value — only for internal use
            const { key } = req.params;
            const res = await query('SELECT ciphertext FROM secrets WHERE key=$1', [key]);
            if (!res.rows.length) { err(ws, req.id, 'NOT_FOUND', `Key not found: ${key}`); break; }
            const value = JSON.parse(decrypt(res.rows[0].ciphertext));
            ok(ws, req.id, { key, value });
            break;
        }

        case 'creds.test': {
            const { connector } = req.params; // e.g. 'telegram', 'gmail'
            if (connector === 'telegram') {
                const { botId } = req.params;
                let token = '';

                if (botId) {
                    // Look for specific bot in telegram.bots
                    const res = await query("SELECT ciphertext FROM secrets WHERE key='telegram.bots'");
                    if (!res.rows.length) { err(ws, req.id, 'NOT_FOUND', 'Nessun bot Telegram configurato.'); break; }
                    const bots = JSON.parse(decrypt(res.rows[0].ciphertext));
                    const bot = bots.find((b: any) => b.id === botId);
                    if (!bot) { err(ws, req.id, 'NOT_FOUND', `Bot ${botId} non trovato.`); break; }
                    token = bot.token;
                } else {
                    // Fallback to legacy single bot
                    const res = await query("SELECT ciphertext FROM secrets WHERE key='telegram.bot_token'");
                    if (!res.rows.length) { err(ws, req.id, 'NOT_FOUND', 'Token Telegram non trovato.'); break; }
                    token = JSON.parse(decrypt(res.rows[0].ciphertext));
                }

                if (!token) { err(ws, req.id, 'INVALID', 'Token vuoto.'); break; }

                // Call Telegram getMe
                const { default: https } = await import('https');
                const result = await new Promise<any>((resolve, reject) => {
                    const url = `https://api.telegram.org/bot${token}/getMe`;
                    https.get(url, (r: any) => {
                        let raw = '';
                        r.on('data', (d: Buffer) => raw += d.toString());
                        r.on('end', () => {
                            try { resolve(JSON.parse(raw)); }
                            catch { reject(new Error('Invalid Telegram API response')); }
                        });
                    }).on('error', reject);
                });

                if (result.ok) {
                    ok(ws, req.id, { ok: true, bot: result.result });
                } else {
                    ok(ws, req.id, { ok: false, message: result.description ?? 'Telegram API error' });
                }
            } else if (connector === 'gmail') {
                // Test IMAP connection with App Password
                const credsRes = await query("SELECT key, ciphertext FROM secrets WHERE key IN ('google.email', 'google.app_password')");
                const creds: Record<string, string> = {};
                for (const row of credsRes.rows) {
                    try { creds[row.key] = JSON.parse(decrypt(row.ciphertext)); } catch {}
                }
                if (!creds['google.email'] || !creds['google.app_password']) {
                    err(ws, req.id, 'NOT_FOUND', 'Credenziali Gmail mancanti. Configura "google.email" e "google.app_password" nel connettore.');
                    break;
                }
                try {
                    const imapMod = await import('imapflow') as any;
                    const ImapFlow = imapMod.ImapFlow ?? imapMod.default?.ImapFlow;
                    const client = new ImapFlow({
                        host: 'imap.gmail.com', port: 993, secure: true,
                        auth: { user: creds['google.email'], pass: creds['google.app_password'] },
                        logger: false,
                    });
                    await client.connect();
                    const info = await client.mailboxOpen('INBOX');
                    await client.logout();
                    ok(ws, req.id, { ok: true, message: `✓ Connessione IMAP riuscita. Inbox: ${info.exists} messaggi.` });
                } catch (e: any) {
                    ok(ws, req.id, { ok: false, message: `Connessione IMAP fallita: ${e.message}` });
                }
            } else if (connector === 'whatsapp') {
                const { getWhatsAppStatus } = await import('../channels/whatsapp/adapter.js');
                const status = getWhatsAppStatus();
                const connected = status === 'connected';
                ok(ws, req.id, { ok: connected, message: connected ? '✓ WhatsApp connesso e funzionante' : `Stato corrente: ${status}` });
            } else if (connector === 'spotify') {
                const credsRes = await query("SELECT key, ciphertext FROM secrets WHERE key IN ('spotify.client_id', 'spotify.client_secret')");
                const creds: Record<string, string> = {};
                for (const row of credsRes.rows) {
                    try { creds[row.key] = JSON.parse(decrypt(row.ciphertext)); } catch {}
                }
                if (!creds['spotify.client_id'] || !creds['spotify.client_secret']) {
                    err(ws, req.id, 'NOT_FOUND', 'Credenziali Spotify mancanti. Configura "spotify.client_id" e "spotify.client_secret" nel connettore.');
                    break;
                }

                const { default: https } = await import('https');
                const basicAuth = Buffer.from(`${creds['spotify.client_id']}:${creds['spotify.client_secret']}`).toString('base64');
                const result = await new Promise<any>((resolve, reject) => {
                    const request = https.request('https://accounts.spotify.com/api/token', {
                        method: 'POST',
                        headers: {
                            Authorization: `Basic ${basicAuth}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    }, (r: any) => {
                        let raw = '';
                        r.on('data', (d: Buffer) => raw += d.toString());
                        r.on('end', () => {
                            try { resolve(JSON.parse(raw)); }
                            catch { reject(new Error('Invalid Spotify API response')); }
                        });
                    });
                    request.on('error', reject);
                    request.write('grant_type=client_credentials');
                    request.end();
                });

                if (result.access_token) {
                    ok(ws, req.id, { ok: true, message: 'Spotify token ottenuto correttamente.' });
                } else {
                    ok(ws, req.id, { ok: false, message: result.error_description ?? result.error?.message ?? 'Spotify API error' });
                }
            } else if (connector === 'printer') {
                let configuredPrinter = '';
                try {
                    const prefRes = await query("SELECT ciphertext FROM secrets WHERE key='printer.default_name'");
                    if (prefRes.rows.length) {
                        configuredPrinter = String(JSON.parse(decrypt(prefRes.rows[0].ciphertext as string)) || '').trim();
                    }
                } catch {}

                try {
                    const { execFile } = await import('node:child_process');
                    const { promisify } = await import('node:util');
                    const execFileAsync = promisify(execFile);

                    if (process.platform === 'win32') {
                        const out = await execFileAsync('powershell', ['-NoProfile', '-Command', 'Get-Printer | Where-Object { $_.Default -eq $true } | Select-Object -ExpandProperty Name']);
                        const defaultPrinter = (out.stdout || '').trim();
                        ok(ws, req.id, {
                            ok: true,
                            defaultPrinter: defaultPrinter || null,
                            configuredPrinter: configuredPrinter || null,
                            message: defaultPrinter
                                ? 'Stampante predefinita rilevata: ' + defaultPrinter
                                : 'Servizio stampa disponibile ma nessuna stampante predefinita rilevata.'
                        });
                    } else {
                        const out = await execFileAsync('lpstat', ['-d']);
                        const stdout = String(out.stdout || '').trim();
                        const marker = 'system default destination:';
                        const lower = stdout.toLowerCase();
                        const defaultPrinter = lower.includes(marker)
                            ? stdout.slice(lower.indexOf(marker) + marker.length).trim()
                            : stdout;
                        ok(ws, req.id, {
                            ok: true,
                            defaultPrinter: defaultPrinter || null,
                            configuredPrinter: configuredPrinter || null,
                            message: defaultPrinter
                                ? 'Stampante predefinita rilevata: ' + defaultPrinter
                                : 'Backend di stampa disponibile, ma stampante predefinita non rilevata.'
                        });
                    }
                } catch (e: any) {
                    const code = e?.code === 'ENOENT' ? 'Backend di stampa non disponibile (lpstat/powershell non trovato).' : 'Test stampante fallito: ' + e.message;
                    ok(ws, req.id, { ok: false, configuredPrinter: configuredPrinter || null, message: code });
                }

            } else if (connector === 'tavily') {
                const credsRes = await query("SELECT ciphertext FROM secrets WHERE key='tavily.api_key'");
                if (!credsRes.rows.length) {
                    err(ws, req.id, 'NOT_FOUND', 'API key Tavily non configurata.');
                    break;
                }
                const apiKey = JSON.parse(decrypt(credsRes.rows[0].ciphertext as string));
                const { default: https } = await import('https');
                const bodyStr = JSON.stringify({ api_key: apiKey, query: 'test', max_results: 1 });
                const result = await new Promise<any>((resolve, reject) => {
                    const request = https.request('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(bodyStr),
                        },
                    }, (r: any) => {
                        let raw = '';
                        r.on('data', (d: Buffer) => { raw += d.toString(); });
                        r.on('end', () => {
                            try { resolve({ status: r.statusCode, body: JSON.parse(raw) }); }
                            catch { reject(new Error('Risposta non JSON da Tavily')); }
                        });
                    });
                    request.on('error', reject);
                    request.write(bodyStr);
                    request.end();
                });
                if (result.status < 400) {
                    ok(ws, req.id, { ok: true, message: '✓ Connessione Tavily riuscita. API key valida.' });
                } else {
                    const detail = result.body?.detail || result.body?.error?.message || `HTTP ${result.status}`;
                    ok(ws, req.id, { ok: false, message: `Tavily API error: ${detail}` });
                }
            } else {
                err(ws, req.id, 'UNKNOWN_CONNECTOR', `Connettore sconosciuto: ${connector}`);
            }
            break;
        }

        // ── Google Drive ──────────────────────────────────────────────
        case 'googledrive.startAuth': {
            const { clientId, clientSecret } = req.params;
            if (!clientId || !clientSecret) {
                err(ws, req.id, 'INVALID_PARAMS', 'clientId e clientSecret obbligatori');
                break;
            }
            const { setPendingCredentials, buildAuthUrl, driveAuthEmitter, DRIVE_REDIRECT_URI } = await import('../runtime/googleDriveAuth.js');
            setPendingCredentials(clientId.trim(), clientSecret.trim());
            const authUrl = buildAuthUrl(clientId.trim());

            // Quando il callback HTTP completa, notifica la UI via WebSocket
            driveAuthEmitter.once('auth_complete', () => {
                event(wss, 'googledrive.auth_complete', { ok: true });
            });

            ok(ws, req.id, { authUrl, redirectUri: DRIVE_REDIRECT_URI });
            break;
        }

        case 'googledrive.getStatus': {
            const { getDriveAuthStatus } = await import('../runtime/googleDriveAuth.js');
            const status = await getDriveAuthStatus();
            ok(ws, req.id, status);
            break;
        }

        case 'googledrive.revokeAuth': {
            await query("DELETE FROM secrets WHERE key IN ('google.drive_refresh_token')");
            ok(ws, req.id, { revoked: true });
            break;
        }

        // ── WhatsApp ─────────────────────────────────────────────────
        case 'whatsapp.getStatus': {
            try {
                const { getWhatsAppStatus, getWhatsAppQR } = await import('../channels/whatsapp/adapter.js');
                ok(ws, req.id, { status: getWhatsAppStatus(), qr: getWhatsAppQR() });
            } catch {
                ok(ws, req.id, { status: 'disconnected', qr: null });
            }
            break;
        }

        // ── Lives (extended) ─────────────────────────────────────────
        case 'live.get': {
            const { id } = req.params;
            const res = await query('SELECT * FROM lives WHERE id=$1', [id]);
            if (!res.rows.length) { err(ws, req.id, 'NOT_FOUND', `Live not found: ${id}`); break; }
            ok(ws, req.id, res.rows[0]);
            break;
        }

        case 'live.update': {
            const { id, name, description, system_prompt, model_provider, model_name, channels, routing_default, skills, webhook_ids } = req.params;
            let { llm_config_id } = req.params;
            const guardrail = req.params.guardrail !== undefined ? req.params.guardrail : undefined;

            logger.info(`Incoming live.update params: ${JSON.stringify(req.params)}`);

            if (llm_config_id === '') llm_config_id = null;

            const personality = system_prompt !== undefined ? system_prompt : description;
            const guardrailJson = guardrail && Object.keys(guardrail).length > 0 ? guardrail : null;

            // 1. Update Database
            await query(
                `UPDATE lives SET
                  name = COALESCE($2, name),
                  description = COALESCE($3, description),
                  system_prompt = COALESCE($4, system_prompt),
                  model_provider = COALESCE($5, model_provider),
                  model_name = COALESCE($6, model_name),
                  channels = COALESCE($7::jsonb, channels),
                  routing_default = COALESCE($8, routing_default),
                  skills = COALESCE($9::jsonb, skills),
                  webhook_ids = COALESCE($10::jsonb, webhook_ids),
                  llm_config_id = CASE WHEN $11::text IS NOT NULL THEN $11 ELSE (CASE WHEN $12 = true THEN NULL ELSE llm_config_id END) END,
                  guardrail = CASE WHEN $13::text IS NOT NULL THEN $13::jsonb ELSE guardrail END,
                  updated_at = now()
                WHERE id=$1`,
                [id, name, description ?? null, personality ?? null, model_provider ?? null, model_name ?? null,
                    channels ? JSON.stringify(channels) : null,
                    routing_default !== undefined ? routing_default : null,
                    skills ? JSON.stringify(skills) : null,
                    webhook_ids ? JSON.stringify(webhook_ids) : null,
                    llm_config_id ?? null,
                    llm_config_id === null,
                    guardrail !== undefined ? JSON.stringify(guardrailJson) : null]
            );

            // 2. Fetch full current state to sync to file
            const res = await query('SELECT * FROM lives WHERE id=$1', [id]);
            if (res.rows.length) {
                const live = res.rows[0];
                try {
                    const { writeFile } = await import('fs/promises');
                    const guardrailYaml = live.guardrail ? `\nguardrail: ${JSON.stringify(live.guardrail)}` : '';
                    const content = `---\nid: ${live.id}\nname: "${live.name}"\ndescription: "${live.description || ''}"\nmodel:\n  provider: ${live.model_provider}\n  name: ${live.model_name}\n  config_id: ${live.llm_config_id || null}\nrouting:\n  default: ${live.routing_default}\nskills: ${JSON.stringify(live.skills)}\nwebhook_ids: ${JSON.stringify(live.webhook_ids || [])}\npolicy:\n  tool_allow: []\n  tool_deny: []\nmemory:\n  mode: workspace_md\n  files: []${guardrailYaml}\n---\n\n# Personality / SOUL\n${live.system_prompt}\n`;
                    if (live.file_path) {
                        logger.info(`Syncing live to file: ${live.file_path}`);
                        await writeFile(live.file_path, content, 'utf8');
                        logger.info(`Successfully synced live ${id} to ${live.file_path}`);
                    }
                } catch (syncErr: any) {
                    logger.error(`Failed to sync live ${id} to file: ${syncErr.message}`);
                }
            }

            ok(ws, req.id, { updated: id });
            break;
        }

        case 'live.delete': {
            const { id } = req.params;
            await query('DELETE FROM lives WHERE id=$1', [id]);
            ok(ws, req.id, { deleted: id });
            break;
        }

        case 'live.trigger': {
            const { id, prompt } = req.params;
            if (!id) { err(ws, req.id, 'INVALID_PARAMS', 'id required'); break; }
            const sessionKey = `ws-trigger:${id}:${Date.now()}`;
            ok(ws, req.id, { sessionKey, status: 'started' });
            // Run async, stream via events
            const { runLive } = await import('../runtime/orchestrator.js');
            runLive({
                liveId: id,
                sessionKey,
                userMessage: prompt || 'Run your task.',
                onDelta: (delta) => send(ws, { type: 'event', event: 'chat.delta', payload: { sessionKey, delta } }),
                onDone: (text) => send(ws, { type: 'event', event: 'chat.final', payload: { sessionKey, text } }),
                onError: (e) => send(ws, { type: 'event', event: 'chat.error', payload: { sessionKey, message: e.message } }),
            }).catch(() => { });
            break;
        }

        case 'crew.get': {
            const { id } = req.params;
            const res = await query('SELECT * FROM crews WHERE id=$1', [id]);
            if (!res.rows.length) { err(ws, req.id, 'NOT_FOUND', `Crew not found: ${id}`); break; }
            ok(ws, req.id, res.rows[0]);
            break;
        }

        case 'crew.update': {
            const { id, name, description, system_prompt, channels, member_live_ids, routing_default, orchestration_mode, model_name } = req.params;
            let { llm_config_id } = req.params;
            if (llm_config_id === '') llm_config_id = null;
            await query(
                `UPDATE crews SET
                  name = COALESCE($2, name),
                  description = COALESCE($3, description),
                  system_prompt = COALESCE($4, system_prompt),
                  channels = COALESCE($5::jsonb, channels),
                  member_live_ids = COALESCE($6::jsonb, member_live_ids),
                  routing_default = COALESCE($7, routing_default),
                  orchestration_mode = COALESCE($8, orchestration_mode),
                  llm_config_id = CASE WHEN $9::text IS NOT NULL THEN $9 ELSE (CASE WHEN $10 = true THEN NULL ELSE llm_config_id END) END,
                  model_name = COALESCE($11, model_name),
                  updated_at = now()
                 WHERE id = $1`,
                [
                    id,
                    name ?? null,
                    description ?? null,
                    system_prompt ?? null,
                    channels ? JSON.stringify(channels) : null,
                    member_live_ids ? JSON.stringify(member_live_ids) : null,
                    routing_default !== undefined ? routing_default : null,
                    orchestration_mode ?? null,
                    llm_config_id ?? null,
                    llm_config_id === null,
                    model_name ?? null
                ]
            );
            ok(ws, req.id, { updated: id });
            break;
        }

        case 'crew.delete': {
            const { id } = req.params;
            await query('DELETE FROM crews WHERE id = $1', [id]);
            ok(ws, req.id, { deleted: id });
            break;
        }

        case 'crew.trigger': {
            const { id, prompt, sessionKey } = req.params;
            if (!id) { err(ws, req.id, 'INVALID_PARAMS', 'id required'); break; }
            const sKey = sessionKey ?? getWsCrewSessionKey(ws, id);
            ok(ws, req.id, { sessionKey: sKey, status: 'started' });
            const { runCrew } = await import('../runtime/crewOrchestrator.js');
            runCrew({
                crewId: id,
                sessionKey: sKey,
                userMessage: prompt || 'Run your task.',
                onDelta: (delta) => send(ws, { type: 'event', event: 'chat.delta', payload: { sessionKey: sKey, delta } }),
                onDone: (text) => send(ws, { type: 'event', event: 'chat.final', payload: { sessionKey: sKey, text } }),
                onError: (e) => send(ws, { type: 'event', event: 'chat.error', payload: { sessionKey: sKey, message: e.message } }),
            }).catch(() => { });
            break;
        }

        case 'crew.history': {
            const { id, sessionKey, limit } = req.params;
            if (!id) { err(ws, req.id, 'INVALID_PARAMS', 'id required'); break; }
            const sKey = sessionKey ?? getWsCrewSessionKey(ws, id);
            const result = await query(
                `SELECT role, content, session_key AS "sessionKey", created_at AS "createdAt"
                 FROM crew_chat_history
                 WHERE crew_id = $1
                   AND session_key = $2
                 ORDER BY created_at DESC, id DESC
                 LIMIT $3`,
                [id, sKey, Math.min(Math.max(Number(limit) || 20, 1), 50)]
            );
            ok(ws, req.id, { sessionKey: sKey, items: result.rows.reverse() });
            break;
        }

        case 'crew.clear': {
            const { id, sessionKey } = req.params;
            if (!id) { err(ws, req.id, 'INVALID_PARAMS', 'id required'); break; }
            const sKey = sessionKey ?? getWsCrewSessionKey(ws, id);
            await query(
                'DELETE FROM crew_chat_history WHERE crew_id = $1 AND session_key = $2',
                [id, sKey]
            );
            ok(ws, req.id, { cleared: true, sessionKey: sKey });
            break;
        }

        // ── Jobs ────────────────────────────────────────────────────
        case 'job.list': {
            const { liveId, crewId } = req.params;
            const res = liveId
                ? await query('SELECT * FROM jobs WHERE live_id=$1 ORDER BY created_at ASC', [liveId])
                : crewId
                    ? await query('SELECT * FROM jobs WHERE crew_id=$1 ORDER BY created_at ASC', [crewId])
                    : await query('SELECT * FROM jobs ORDER BY created_at ASC');
            ok(ws, req.id, res.rows);
            break;
        }

        case 'job.create': {
            const { id, liveId, crewId, name, cronExpr, prompt, startDate, endDate } = req.params;
            if (!liveId && !crewId) {
                err(ws, req.id, 'INVALID_PARAMS', 'liveId or crewId required');
                break;
            }
            if (!cronExpr || !cron.validate(cronExpr)) {
                err(ws, req.id, 'INVALID_PARAMS', `Invalid cron expression: ${cronExpr}`);
                break;
            }
            const jobId = id ?? crypto.randomUUID();
            await query(
                'INSERT INTO jobs (id, live_id, crew_id, name, cron_expr, prompt, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
                [jobId, liveId ?? null, crewId ?? null, name ?? '', cronExpr, prompt ?? '', startDate ?? null, endDate ?? null]
            );
            // Reload scheduler
            const { reloadJobs } = await import('../runtime/scheduler.js');
            await reloadJobs(wss);
            ok(ws, req.id, { id: jobId });
            break;
        }
        case 'job.update': {
            const { id, name, cronExpr, prompt, startDate, endDate, enabled } = req.params;
            if (!id) {
                err(ws, req.id, 'INVALID_PARAMS', 'id required');
                break;
            }
            if (cronExpr !== undefined && !cron.validate(cronExpr)) {
                err(ws, req.id, 'INVALID_PARAMS', `Invalid cron expression: ${cronExpr}`);
                break;
            }

            const normalizedStartDate = startDate === '' ? null : (startDate ?? null);
            const normalizedEndDate = endDate === '' ? null : (endDate ?? null);
            const hasStartDate = startDate !== undefined;
            const hasEndDate = endDate !== undefined;

            const result = await query(
                `UPDATE jobs SET
                    name = COALESCE($2, name),
                    cron_expr = COALESCE($3, cron_expr),
                    prompt = COALESCE($4, prompt),
                    start_date = CASE WHEN $6 THEN $5::timestamptz ELSE start_date END,
                    end_date = CASE WHEN $8 THEN $7::timestamptz ELSE end_date END,
                    enabled = COALESCE($9, enabled)
                 WHERE id=$1`,
                [
                    id,
                    name ?? null,
                    cronExpr ?? null,
                    prompt ?? null,
                    normalizedStartDate,
                    hasStartDate,
                    normalizedEndDate,
                    hasEndDate,
                    enabled !== undefined ? Boolean(enabled) : null
                ]
            );
            if (result.rowCount === 0) {
                err(ws, req.id, 'NOT_FOUND', `Job not found: ${id}`);
                break;
            }

            const { reloadJobs } = await import('../runtime/scheduler.js');
            await reloadJobs(wss);
            ok(ws, req.id, { updated: id });
            break;
        }
        case 'job.delete': {
            const { id } = req.params;
            await query('DELETE FROM jobs WHERE id=$1', [id]);
            const { reloadJobs } = await import('../runtime/scheduler.js');
            await reloadJobs(wss);
            ok(ws, req.id, { deleted: id });
            break;
        }

        // ── LLM Configs ─────────────────────────────────────────────
        case 'llm_config.list': {
            const res = await query('SELECT id, name, provider, base_url, updated_at FROM llm_configs ORDER BY name ASC');
            ok(ws, req.id, res.rows);
            break;
        }

        case 'llm_config.create': {
            const { id = crypto.randomUUID(), name, provider, base_url, api_key } = req.params;
            const cipher = api_key ? encrypt(JSON.stringify(api_key)) : null;
            await query(
                `INSERT INTO llm_configs (id, name, provider, base_url, api_key_cipher) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (id) DO UPDATE SET name=$2, provider=$3, base_url=$4, api_key_cipher=COALESCE($5, llm_configs.api_key_cipher), updated_at=now()`,
                [id, name, provider, base_url ?? null, cipher]
            );
            ok(ws, req.id, { id });
            break;
        }

        case 'llm_config.delete': {
            const { id } = req.params;
            await query('DELETE FROM llm_configs WHERE id=$1', [id]);
            ok(ws, req.id, { deleted: id });
            break;
        }

        // ── Skills ──────────────────────────────────────────────────
        case 'skills.list': {
            const { SkillLoader } = await import('../runtime/skillLoader.js');
            const dir = process.env.SKILLS_DIR ?? '/app/workspace/skills';
            const loader = new SkillLoader(dir);
            await loader.loadAll();
            ok(ws, req.id, loader.getAll());
            break;
        }

        case 'skills.reload': {
            ok(ws, req.id, { reloaded: true });
            break;
        }

        // ── Chat (real LLM) ─────────────────────────────────────────
        case 'chat.send': {
            const { message, liveId, sessionKey, attachments: rawAttachments } = req.params;
            if (!liveId) { err(ws, req.id, 'INVALID_PARAMS', 'liveId required'); break; }
            const sKey = sessionKey ?? getWsSessionKey(ws, liveId);
            ok(ws, req.id, { sessionKey: sKey });

            // Process base64 attachments: save to disk and build attachment metadata
            let channelContext: any = undefined;
            if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
                const fsp = await import('fs/promises');
                const pathMod = await import('path');
                const uploadsDir = process.env.CHAT_UPLOADS_DIR ?? pathMod.default.join(process.cwd(), 'workspace', 'storage', 'chat_uploads');
                await fsp.mkdir(uploadsDir, { recursive: true });

                const savedAttachments: any[] = [];
                for (const att of rawAttachments.slice(0, 5)) {
                    try {
                        const { fileName, mimeType, dataUrl, fileSize } = att;
                        if (!dataUrl || !fileName) continue;
                        // Extract base64 from data URL: "data:image/jpeg;base64,/9j/..."
                        const base64Match = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/);
                        if (!base64Match) continue;
                        const buffer = Buffer.from(base64Match[1], 'base64');
                        const safeName = `${Date.now()}_${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const filePath = pathMod.default.join(uploadsDir, safeName);
                        await fsp.writeFile(filePath, buffer);
                        savedAttachments.push({
                            path: filePath,
                            mimeType: mimeType || 'application/octet-stream',
                            fileName: fileName,
                            fileSize: fileSize || buffer.length
                        });
                        logger.info(`Chat upload saved: ${filePath} (${mimeType}, ${buffer.length} bytes)`);
                    } catch (uploadErr: any) {
                        logger.error(`Failed to save chat upload: ${uploadErr.message}`);
                    }
                }
                if (savedAttachments.length > 0) {
                    channelContext = { attachments: savedAttachments };
                }
            }

            const { runLive } = await import('../runtime/orchestrator.js');
            runLive({
                liveId,
                sessionKey: sKey,
                userMessage: message || '',
                channelContext,
                onDelta: (delta) => send(ws, { type: 'event', event: 'chat.delta', payload: { sessionKey: sKey, delta } }),
                onDone: (text) => send(ws, { type: 'event', event: 'chat.final', payload: { sessionKey: sKey, text } }),
                onError: (e) => send(ws, { type: 'event', event: 'chat.error', payload: { sessionKey: sKey, message: e.message } }),
            }).catch(() => { });
            break;
        }

        case 'chat.history': {
            const { liveId, sessionKey, limit } = req.params;
            if (!liveId) { err(ws, req.id, 'INVALID_PARAMS', 'liveId required'); break; }
            const sKey = sessionKey ?? getWsSessionKey(ws, liveId);
            const result = await query(
                `SELECT role, content, session_key AS "sessionKey", created_at AS "createdAt"
                 FROM chat_history
                 WHERE live_id = $1
                   AND session_key = $2
                 ORDER BY created_at DESC, id DESC
                 LIMIT $3`,
                [liveId, sKey, Math.min(Math.max(Number(limit) || 20, 1), 50)]
            );
            ok(ws, req.id, result.rows.reverse());
            break;
        }

        case 'chat.clear': {
            const { liveId, sessionKey } = req.params;
            if (!liveId) { err(ws, req.id, 'INVALID_PARAMS', 'liveId required'); break; }
            const sKey = sessionKey ?? getWsSessionKey(ws, liveId);
            await query(
                'DELETE FROM chat_history WHERE live_id = $1 AND session_key = $2',
                [liveId, sKey]
            );
            ok(ws, req.id, { cleared: true, sessionKey: sKey });
            break;
        }

        default:
            err(ws, req.id, 'METHOD_NOT_FOUND', `Unknown method: ${req.method}`);
    }
}










