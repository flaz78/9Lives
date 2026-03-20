// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { fetchHtml } from '../util/httpUtils.js';

logger.info('redditTools module loaded');

toolRegistry.register({
    name: 'reddit.search',
    description: 'Search Reddit and return the top posts (title, subreddit, link, text)',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: "The search query" },
            sort: {
                type: 'string',
                description: "Sort order of results",
                enum: ['relevance', 'hot', 'top', 'new', 'comments'],
                default: 'relevance'
            },
            limit: { type: 'number', description: "Maximum number of results (max 25)", default: 10 }
        },
        required: ['query']
    },
    sideEffecting: false,
    handler: async (ctx, input) => {
        const { query, sort = 'relevance', limit = 10 } = input;
        logger.info(`Reddit Search: searching for "${query}" (sort: ${sort}, limit: ${limit})`);

        // Using Reddit's public .json search endpoint
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.reddit.com/search.json?q=${encodedQuery}&sort=${sort}&limit=${limit}`;

        try {
            const { html, finalUrl } = await fetchHtml(url);

            let data;
            try {
                data = JSON.parse(html);
            } catch (e) {
                logger.error('Failed to parse Reddit JSON response', e);
                return { error: "Unable to read the Reddit response. There may be anti-bot protection or the URL is incorrect." };
            }

            if (!data.data || !data.data.children) {
                return { message: "No results found on Reddit.", url: finalUrl };
            }

            const results = data.data.children.map((child: any) => {
                const post = child.data;
                return {
                    title: post.title,
                    subreddit: post.subreddit_name_prefixed,
                    author: post.author,
                    url: `https://www.reddit.com${post.permalink}`,
                    external_url: post.url,
                    score: post.score,
                    num_comments: post.num_comments,
                    content: post.selftext ? (post.selftext.substring(0, 1000) + (post.selftext.length > 1000 ? '...' : '')) : "[Link or Image]"
                };
            });

            return {
                url: finalUrl,
                count: results.length,
                results
            };

        } catch (err: any) {
            logger.error(`Reddit Search error for query "${query}"`, err);
            throw new Error(`Reddit search error: ${err.message}`);
        }
    }
});
