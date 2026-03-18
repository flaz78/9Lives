// Copyright (c) 2026 Flavio Cerato
import { logger } from '../../util/logger.js';

export class GmailAdapter {
    constructor() { }

    async start() {
        logger.info('Gmail Adapter initialized (Awaiting OAuth)');
    }

    async getAuthUrl() {
        // Generate Google OAuth URL
        return 'https://accounts.google.com/o/oauth2/v2/auth?...';
    }

    async handleCallback(code: string) {
        logger.info(`Gmail OAuth callback received: ${code}`);
        // exchange code for tokens and save to postgres
    }
}
