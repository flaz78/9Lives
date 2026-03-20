// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { fetchHtml } from '../util/httpUtils.js';

logger.info('searchTools module loaded');

toolRegistry.register({
    name: 'search.duckduckgo',
    description: 'Perform a DuckDuckGo search and return the top results',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: "The search query (e.g. 'weather Milan')" }
        },
        required: ['query']
    },
    sideEffecting: false,
    handler: async (ctx, input) => {
        const { query } = input;
        logger.info(`Search: performing DuckDuckGo search for "${query}"`);

        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        try {
            const { html, finalUrl } = await fetchHtml(url);
            logger.info(`Search: received HTML response from ${finalUrl} (${html.length} bytes)`);

            const results: any[] = [];

            // 1. Try HTML version regex (result__body)
            const htmlBlockRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
            const htmlTitleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/;
            const htmlSnippetRegex = /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/;
            const htmlLinkRegex = /href="([^"]*)"/;

            let match;
            let count = 0;
            while ((match = htmlBlockRegex.exec(html)) !== null && count < 5) {
                const block = match[1];
                const titleMatch = htmlTitleRegex.exec(block);
                const snippetMatch = htmlSnippetRegex.exec(block);

                if (titleMatch) {
                    const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
                    const linkMatch = htmlLinkRegex.exec(titleMatch[0]);
                    const link = linkMatch ? linkMatch[1] : '';
                    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';

                    if (title) {
                        results.push({ title, link, snippet });
                        count++;
                    }
                }
            }

            // 2. Fallback to Lite version regex (table based)
            if (results.length === 0) {
                const liteRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
                while ((match = liteRegex.exec(html)) !== null && count < 5) {
                    const link = match[1];
                    const title = match[2].replace(/<[^>]*>/g, '').trim();
                    const snippet = match[3].replace(/<[^>]*>/g, '').trim();
                    results.push({ title, link, snippet });
                    count++;
                }
            }

            // 3. Last resort: just link and title
            if (results.length === 0) {
                const lastResortRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
                while ((match = lastResortRegex.exec(html)) !== null && count < 5) {
                    results.push({
                        title: match[2].replace(/<[^>]*>/g, '').trim(),
                        link: match[1],
                        snippet: ''
                    });
                    count++;
                }
            }

            if (results.length === 0) {
                return { message: "No results found or anti-bot protection active." };
            }

            return { results };
        } catch (err: any) {
            logger.error(`Search error for query "${query}"`, err);
            throw new Error(`DuckDuckGo search error: ${err.message}`);
        }
    }
});
