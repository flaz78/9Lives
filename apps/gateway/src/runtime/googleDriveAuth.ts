// Copyright (c) 2026 Flavio Cerato
import EventEmitter from 'node:events';
import { query } from '../storage/pg/pool.js';
import { encrypt, decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';

// ── Constants ─────────────────────────────────────────────────────────────

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? '18789', 10);
export const DRIVE_REDIRECT_URI = `http://localhost:${GATEWAY_PORT}/oauth/googledrive/callback`;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

// ── Event emitter (bridges HTTP callback → WebSocket notification) ─────────

export const driveAuthEmitter = new EventEmitter();

// ── Pending auth state ────────────────────────────────────────────────────

let pendingClientId:     string | null = null;
let pendingClientSecret: string | null = null;

export function setPendingCredentials(clientId: string, clientSecret: string) {
    pendingClientId     = clientId;
    pendingClientSecret = clientSecret;
}

// ── Build OAuth authorization URL ─────────────────────────────────────────

export function buildAuthUrl(clientId: string): string {
    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  DRIVE_REDIRECT_URI,
        response_type: 'code',
        scope:         DRIVE_SCOPE,
        access_type:   'offline',
        prompt:        'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ── Exchange authorization code for tokens ────────────────────────────────

async function exchangeCode(
    code:         string,
    clientId:     string,
    clientSecret: string,
): Promise<{ refresh_token: string; access_token: string }> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
            code,
            client_id:     clientId,
            client_secret: clientSecret,
            redirect_uri:  DRIVE_REDIRECT_URI,
            grant_type:    'authorization_code',
        }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(`OAuth error: ${data.error_description ?? data.error}`);
    if (!data.refresh_token) throw new Error('No refresh_token received. Make sure you are using "access_type=offline" and "prompt=consent".');
    return { refresh_token: data.refresh_token, access_token: data.access_token };
}

// ── Called by HTTP callback when Google redirects back ────────────────────

export async function handleDriveCallback(code: string): Promise<void> {
    if (!pendingClientId || !pendingClientSecret) {
        throw new Error('No authorization in progress. Restart the flow from the Connectors panel.');
    }

    const clientId     = pendingClientId;
    const clientSecret = pendingClientSecret;
    pendingClientId     = null;
    pendingClientSecret = null;

    logger.info('Google Drive: exchanging authorization code...');
    const tokens = await exchangeCode(code, clientId, clientSecret);

    await query(
        'INSERT INTO secrets (key, ciphertext) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET ciphertext=$2, updated_at=now()',
        ['google.drive_client_id', encrypt(JSON.stringify(clientId))]
    );
    await query(
        'INSERT INTO secrets (key, ciphertext) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET ciphertext=$2, updated_at=now()',
        ['google.drive_client_secret', encrypt(JSON.stringify(clientSecret))]
    );
    await query(
        'INSERT INTO secrets (key, ciphertext) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET ciphertext=$2, updated_at=now()',
        ['google.drive_refresh_token', encrypt(JSON.stringify(tokens.refresh_token))]
    );

    logger.info('Google Drive: authorization complete, refresh token stored.');
    driveAuthEmitter.emit('auth_complete', { ok: true });
}

// ── Get a fresh access token using stored refresh token ───────────────────

export async function getDriveAccessToken(): Promise<string> {
    const res = await query(
        "SELECT key, ciphertext FROM secrets WHERE key IN ('google.drive_client_id','google.drive_client_secret','google.drive_refresh_token')"
    );
    const creds: Record<string, string> = {};
    for (const row of res.rows) {
        try { creds[row.key] = JSON.parse(decrypt(row.ciphertext)); } catch {}
    }

    if (!creds['google.drive_client_id'])     throw new Error('Client ID Google Drive non configurato. Vai in Connectors → Google Drive.');
    if (!creds['google.drive_client_secret']) throw new Error('Client Secret Google Drive non configurato. Vai in Connectors → Google Drive.');
    if (!creds['google.drive_refresh_token']) throw new Error('Google Drive non autorizzato. Clicca "Autorizza Drive" nel pannello Connectors.');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
            client_id:     creds['google.drive_client_id'],
            client_secret: creds['google.drive_client_secret'],
            refresh_token: creds['google.drive_refresh_token'],
            grant_type:    'refresh_token',
        }),
    });
    const data = await tokenRes.json() as any;
    if (data.error) throw new Error(`Token refresh error: ${data.error_description ?? data.error}`);
    return data.access_token as string;
}

// ── Check if Drive is fully configured ───────────────────────────────────

export async function getDriveAuthStatus(): Promise<{ configured: boolean; authorized: boolean }> {
    try {
        const res  = await query("SELECT key FROM secrets WHERE key IN ('google.drive_client_id','google.drive_client_secret','google.drive_refresh_token')");
        const keys = new Set(res.rows.map((r: any) => r.key));
        return {
            configured: keys.has('google.drive_client_id') && keys.has('google.drive_client_secret'),
            authorized: keys.has('google.drive_refresh_token'),
        };
    } catch {
        return { configured: false, authorized: false };
    }
}
