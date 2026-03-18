// Copyright (c) 2026 Flavio Cerato
import { Express } from 'express';
import path from 'path';
import fs from 'fs';
import express from 'express';

const uiPath = process.env.UI_DIST_PATH
    ?? path.resolve(process.cwd(), 'ui-dist');
const workspaceBootstrapDir = path.resolve(process.cwd(), 'workspace/bootstrap');
const packagedBootstrapDir = path.resolve(process.cwd(), 'bootstrap');
const bootstrapPath = process.env.BOOTSTRAP_DIR
    ?? (fs.existsSync(workspaceBootstrapDir) ? workspaceBootstrapDir : packagedBootstrapDir);

export function setupHttpServer(app: Express) {
    app.get('/healthz', (_req, res) => {
        res.json({ status: 'ok', uptime: process.uptime(), version: '0.1.0' });
    });

    app.get('/oauth/googledrive/callback', async (req, res) => {
        const { code, error } = req.query as Record<string, string>;

        if (error) {
            res.status(400).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:4rem auto;text-align:center">
                <h2>Autorizzazione negata</h2><p>${error}</p><p>Puoi chiudere questa finestra.</p></body></html>`);
            return;
        }
        if (!code) {
            res.status(400).send('<!DOCTYPE html><html><body>Nessun codice ricevuto.</body></html>');
            return;
        }

        try {
            const { handleDriveCallback } = await import('../runtime/googleDriveAuth.js');
            await handleDriveCallback(code);
            res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:4rem auto;text-align:center">
                <h2 style="color:#34d399">Google Drive autorizzato</h2>
                <p>Puoi chiudere questa finestra e tornare all'app.</p>
                <script>setTimeout(()=>window.close(),3000)</script>
            </body></html>`);
        } catch (e: any) {
            res.status(500).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:4rem auto;text-align:center">
                <h2>Errore</h2><p>${e.message}</p></body></html>`);
        }
    });

    app.get('/', (_req, res) => {
        res.redirect('/ui/');
    });

    app.get('/bootstrap/:file', (req, res) => {
        const fileName = path.basename(req.params.file || '');
        if (!fileName.endsWith('.md')) {
            res.status(404).end();
            return;
        }
        res.sendFile(path.join(bootstrapPath, fileName), (err) => {
            if (!err) return;
            const statusCode = typeof (err as any).statusCode === 'number' ? (err as any).statusCode : 404;
            res.status(statusCode).end();
        });
    });

    app.use('/ui', express.static(uiPath));

    app.get('/ui/*', (_req, res) => {
        res.sendFile(path.join(uiPath, 'index.html'));
    });
}
