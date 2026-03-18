// Copyright (c) 2026 Flavio Cerato
import https from 'https';
import http from 'http';
import { logger } from './logger.js';

export interface FetchResult {
    html: string;
    finalUrl: string;
    statusCode: number;
}

export const fetchHtml = (url: string, maxRedirects = 5): Promise<FetchResult> => {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'));
            return;
        }

        const client = url.startsWith('https') ? https : http;
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            timeout: 10000
        };

        const request = client.get(url, options, (res: any) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const nextUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                logger.info(`HTTP: following redirect to ${nextUrl}`);
                resolve(fetchHtml(nextUrl, maxRedirects - 1));
                return;
            }

            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => resolve({ html: data, finalUrl: url, statusCode: res.statusCode || 0 }));
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Request timed out'));
        });
    });
};
