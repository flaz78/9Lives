// Copyright (c) 2026 Flavio Cerato
import 'dotenv/config';
import http from 'http';
import express from 'express';
import { setupHttpServer } from './http/httpServer.js';
import { setupWsServer } from './ws/wsServer.js';
import { logger } from './util/logger.js';
import { waitForDb } from './storage/pg/pool.js';
import { runMigrations } from './storage/pg/migrate.js';
import { startTelegramAdapter } from './channels/telegram/adapter.js';
import { startWhatsAppAdapter } from './channels/whatsapp/adapter.js';
import { startScheduler } from './runtime/scheduler.js';
logger.info('Starting tool registration...');
import './runtime/fsTools.js';
import './runtime/searchTools.js';
import './runtime/browserTools.js';
import './runtime/jobTools.js';
import './runtime/redditTools.js';
import './runtime/gmailTools.js';
import './runtime/googleCalendarTools.js';
import './runtime/googleDriveTools.js';
import './runtime/excelTools.js';
import './runtime/wordTools.js';
import './runtime/pdfTools.js';
import './runtime/chatMemoryTools.js';
import './runtime/spotifyTools.js';
import './runtime/imageBase64Tools.js';
import './runtime/webhookTools.js';
import './runtime/tavilyTools.js';
import './runtime/printTools.js';
import './runtime/remotionTools.js';
logger.info('Tool registration complete.');

async function registerOptionalTools() {
    const explicitFlag = process.env.PLAYWRIGHT_ENABLED;
    const playwrightEnabled = explicitFlag
        ? explicitFlag.toLowerCase() === 'true'
        : process.arch !== 'arm64';

    if (!playwrightEnabled) {
        logger.info('Playwright tools disabled (set PLAYWRIGHT_ENABLED=true to enable).');
        return;
    }

    try {
        await import('./runtime/playwrightTools.js');
        logger.info('Playwright tools enabled.');
    } catch (err: any) {
        logger.warn(`Playwright tools not loaded: ${err?.message ?? String(err)}`);
    }
}

const PORT = parseInt(process.env.GATEWAY_PORT ?? '18789', 10);
const BIND = process.env.GATEWAY_BIND ?? '127.0.0.1';

const app = express();
app.use(express.json());

setupHttpServer(app);

const server = http.createServer(app);
const wss = setupWsServer(server);

async function start() {
    await registerOptionalTools();

    await waitForDb();
    await runMigrations().catch(err => {
        logger.error('Failed to run migrations:', err);
        process.exit(1);
    });

    server.listen(PORT, BIND, async () => {
        logger.info(`Gateway listening on ${BIND}:${PORT}`);

        // Start optional adapters
        if (process.env.TELEGRAM_ENABLED === 'true') {
            await startTelegramAdapter(wss).catch(e => logger.warn('Telegram adapter failed to start:', e.message));
        }
        if (process.env.WHATSAPP_ENABLED === 'true') {
            await startWhatsAppAdapter(wss).catch(e => logger.warn('WhatsApp adapter failed to start:', e.message));
        }

        // Start cron scheduler
        await startScheduler(wss).catch(e => logger.warn('Scheduler failed to start:', e.message));
    });
}

start().catch(err => {
    logger.error('Startup failed:', err);
    process.exit(1);
});

server.on('error', (err: any) => {
    logger.error('Server error:', err);
    process.exit(1);
});
