// Copyright (c) 2026 Flavio Cerato
import { chromium, type Browser, type Page } from 'playwright';
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import path from 'path';
import fs from 'fs/promises';

logger.info('playwrightTools module loaded');

let browser: Browser | null = null;
let page: Page | null = null;

function normalizeWaitUntil(waitUntil: string): 'load' | 'domcontentloaded' | 'networkidle' | 'commit' {
    switch (waitUntil) {
        case 'networkidle0':
        case 'networkidle2':
            return 'networkidle';
        case 'load':
        case 'domcontentloaded':
        case 'networkidle':
        case 'commit':
            return waitUntil;
        default:
            return 'networkidle';
    }
}

async function getBrowser() {
    if (browser) {
        // Check if browser is still alive
        try {
            if (!browser.isConnected()) {
                logger.warn('Playwright: browser disconnected, relaunching...');
                browser = null;
                page = null;
            }
        } catch {
            browser = null;
            page = null;
        }
    }
    if (!browser) {
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-gpu-sandbox',
                '--disable-gpu-compositing',
                '--disable-gpu-rasterization',
                '--single-process',
                '--no-zygote',
            ]
        });
        browser.on('disconnected', () => {
            logger.warn('Playwright: browser disconnected event');
            browser = null;
            page = null;
        });
    }
    return browser;
}

async function getPage() {
    const b = await getBrowser();
    if (page) {
        try {
            // Verify page is still usable
            if (page.isClosed()) {
                logger.warn('Playwright: page was closed, creating new one...');
                page = null;
            }
        } catch {
            page = null;
        }
    }
    if (!page) {
        page = await b.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
    }
    return page;
}

toolRegistry.register({
    name: 'browser.navigate',
    description: 'Navigate to a URL using a real browser, waiting for dynamic content (JS) to load',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: "The URL of the page to visit" },
            wait_until: {
                type: 'string',
                description: "When to consider the page loaded",
                enum: ['load', 'domcontentloaded', 'networkidle', 'commit', 'networkidle0', 'networkidle2'],
                default: 'networkidle'
            }
        },
        required: ['url']
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const { url, wait_until = 'networkidle' } = input;
        const normalizedWaitUntil = normalizeWaitUntil(wait_until);
        logger.info(`Playwright: navigating to ${url} (waitUntil: ${normalizedWaitUntil})`);

        try {
            const p = await getPage();
            await p.goto(url, { waitUntil: normalizedWaitUntil, timeout: 60000 });

            const title = await p.title();
            const content = (await p.locator('body').innerText().catch(() => '')) || '';

            return {
                url: p.url(),
                title,
                content: content.substring(0, 5000) + (content.length > 5000 ? '... [Truncated]' : '')
            };
        } catch (err: any) {
            logger.error(`Playwright navigation error for ${url}`, err);
            throw new Error(`Playwright navigation error: ${err.message}`);
        }
    }
});

toolRegistry.register({
    name: 'browser.screenshot',
    description: 'Capture a screenshot of the current page and save it to the output folder',
    inputSchema: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: "Filename for the screenshot (e.g. 'screenshot.png')" }
        },
        required: []
    },
    sideEffecting: true,
    handler: async (ctx, input) => {
        const safeInput = input || {};
        const filename = (typeof safeInput.filename === 'string' && safeInput.filename) ? safeInput.filename : `screenshot_${Date.now()}.png`;
        const cwd = process.cwd() || '/app';
        const outputPath = process.env.OUTPUT_DIR || path.join(cwd, 'workspace', 'storage', 'output');
        await fs.mkdir(outputPath, { recursive: true });
        const fullPath = path.join(outputPath, filename);

        logger.info(`Playwright: taking screenshot to ${fullPath}`);

        try {
            const p = await getPage();
            await p.screenshot({ path: fullPath, fullPage: true });

            return {
                status: 'success',
                path: fullPath,
                message: `Screenshot saved successfully to ${filename}`
            };
        } catch (err: any) {
            logger.error(`Playwright screenshot error`, err);
            throw new Error(`Screenshot error: ${err.message}`);
        }
    }
});
