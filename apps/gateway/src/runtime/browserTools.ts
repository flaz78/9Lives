// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { fetchHtml } from '../util/httpUtils.js';

logger.info('browserTools module loaded');

toolRegistry.register({
    name: 'browser.extractText',
    description: 'Fetches a URL and returns the clean text content of the page',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: "L'URL della pagina da leggere (es: 'https://example.com')" }
        },
        required: ['url']
    },
    sideEffecting: false,
    handler: async (ctx, input) => {
        const { url } = input;
        logger.info(`Browser: extracting text from ${url}`);

        try {
            const { html, statusCode } = await fetchHtml(url);

            if (statusCode >= 400) {
                return { error: `Errore HTTP ${statusCode} during the page recovery.` };
            }

            // Clean HTML to extract text
            let text = html
                // Remove scripts and styles
                .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
                .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
                // Remove tags
                .replace(/<[^>]*>/g, ' ')
                // Decode entities (basic)
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                // Whitespace cleanup
                .replace(/\s+/g, ' ')
                .trim();

            if (text.length > 10000) {
                text = text.substring(0, 10000) + "... [Text truncated due to length]";
            }

            return {
                url,
                title: (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'No title',
                content: text
            };
        } catch (err: any) {
            logger.error(`Browser error for URL ${url}`, err);
            throw new Error(`Error extracting text: ${err.message}`);
        }
    }
});
