// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import fs from 'node:fs';
import path from 'node:path';

logger.info('gmailTools module loaded');

// ── Credential helper ─────────────────────────────────────────────────────

async function getGmailCreds(): Promise<{ email: string; password: string }> {
    const res = await query(
        "SELECT key, ciphertext FROM secrets WHERE key IN ('google.email', 'google.app_password')"
    );

    const creds: Record<string, string> = {};
    for (const row of res.rows) {
        try {
            creds[row.key] = JSON.parse(decrypt(row.ciphertext as string));
        } catch {
            throw new Error(`Error decrypting Gmail credential: ${row.key}`);
        }
    }

    if (!creds['google.email']) {
        throw new Error(
            'Missing credential: "google.email". ' +
            'Go to Settings → Credentials and add your Gmail email.'
        );
    }
    if (!creds['google.app_password']) {
        throw new Error(
            'Missing credential: "google.app_password". ' +
            'Go to Settings → Credentials and add your Gmail App Password.'
        );
    }

    return { email: creds['google.email'], password: creds['google.app_password'] };
}

// ── IMAP helper ───────────────────────────────────────────────────────────

async function withImap<T>(
    email: string,
    password: string,
    mailbox: string,
    fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
    const client = new ImapFlow({
        host:   'imap.gmail.com',
        port:   993,
        secure: true,
        auth:   { user: email, pass: password },
        logger: false,
        tls:    { rejectUnauthorized: false },
    });

    await client.connect();
    try {
        await client.mailboxOpen(mailbox);
        return await fn(client);
    } finally {
        await client.logout().catch(() => {});
    }
}

// ── Gmail query → IMAP search criteria ───────────────────────────────────

function parseGmailQuery(q: string): object {
    const criteria: any = {};
    const remaining: string[] = [];

    for (const part of q.trim().split(/\s+/)) {
        if      (part.startsWith('from:'))    { criteria.from    = part.slice(5); }
        else if (part.startsWith('to:'))      { criteria.to      = part.slice(3); }
        else if (part.startsWith('subject:')) { criteria.subject = part.slice(8); }
        else if (part === 'is:unread')        { criteria.unseen  = true; }
        else if (part === 'is:read')          { criteria.seen    = true; }
        else if (part.startsWith('after:'))   { criteria.since   = new Date(part.slice(6).replace(/\//g, '-')); }
        else if (part.startsWith('before:'))  { criteria.before  = new Date(part.slice(7).replace(/\//g, '-')); }
        else                                  { remaining.push(part); }
    }

    if (remaining.length > 0) criteria.body = remaining.join(' ');
    return Object.keys(criteria).length > 0 ? criteria : { all: true };
}

// ── SMTP helper ───────────────────────────────────────────────────────────

function createTransport(email: string, password: string) {
    return nodemailer.createTransport({
        host:   'smtp.gmail.com',
        port:   587,
        secure: false,
        auth:   { user: email, pass: password },
        tls:    { rejectUnauthorized: false },
    });
}

// ── Attachment builder ────────────────────────────────────────────────────

interface AttachmentInput {
    filename:     string;
    path?:        string;  // absolute path on the server
    content?:     string;  // content in base64
    contentType?: string;
}

function buildAttachments(attachments: AttachmentInput[]): any[] {
    return attachments.map((att, i) => {
        if (!att.filename) throw new Error(`Attachment #${i + 1}: "filename" field is required.`);

        const result: any = { filename: att.filename };
        if (att.contentType) result.contentType = att.contentType;

        if (att.path) {
            const resolved = path.resolve(att.path);
            if (!fs.existsSync(resolved)) {
                throw new Error(`File not found: ${att.path}`);
            }
            result.path = resolved;
        } else if (att.content) {
            result.content  = Buffer.from(att.content, 'base64');
            result.encoding = 'base64';
        } else {
            throw new Error(`Attachment "${att.filename}": specify either "path" (file path) or "content" (base64).`);
        }

        return result;
    });
}

// ── Tool: listEmails ──────────────────────────────────────────────────────

toolRegistry.register({
    name:        'gmail.listEmails',
    description: 'Lists recent emails from the Gmail mailbox (inbox or other folder)',
    inputSchema: {
        type: 'object',
        properties: {
            maxResults: { type: 'number',  description: 'Maximum number of emails to return (default: 10)', default: 10 },
            labelIds:   { type: 'string',  description: "Folder: 'INBOX', '[Gmail]/Sent Mail', '[Gmail]/Trash', '[Gmail]/Spam' (default: INBOX)", default: 'INBOX' },
            unreadOnly: { type: 'boolean', description: 'If true, show only unread emails (default: false)', default: false },
        },
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { maxResults = 10, labelIds = 'INBOX', unreadOnly = false } = input;

        logger.info(`Gmail: listEmails (label: ${labelIds}, max: ${maxResults})`);

        const { email, password } = await getGmailCreds();

        const emails = await withImap(email, password, labelIds, async (client) => {
            const searchCriteria: any = unreadOnly ? { unseen: true } : { all: true };
            const rawUids = await client.search(searchCriteria, { uid: true });
            const uids = rawUids === false ? [] : rawUids;
            const recentUids = uids.slice(-Math.min(maxResults, 50));

            if (recentUids.length === 0) return [];

            const results: any[] = [];
            for await (const msg of client.fetch(
                recentUids,
                { envelope: true, flags: true, uid: true },
                { uid: true }
            )) {
                results.push({
                    id:       String(msg.uid),
                    from:     msg.envelope?.from?.[0]?.address ?? '',
                    fromName: msg.envelope?.from?.[0]?.name    ?? '',
                    to:       (msg.envelope?.to ?? []).map((a: any) => a.address).join(', '),
                    subject:  msg.envelope?.subject  ?? '(no subject)',
                    date:     msg.envelope?.date?.toISOString() ?? '',
                    unread:   msg.flags ? !msg.flags.has('\\Seen') : true,
                });
            }

            return results.reverse(); // most recent first
        });

        return { count: emails.length, emails };
    },
});

// ── Tool: readEmail ───────────────────────────────────────────────────────

toolRegistry.register({
    name:        'gmail.readEmail',
    description: 'Reads the full content of a Gmail email by its ID (IMAP UID)',
    inputSchema: {
        type: 'object',
        properties: {
            messageId:  { type: 'string',  description: "Message ID (obtainable from listEmails or searchEmails)" },
            mailbox:    { type: 'string',  description: "Folder: 'INBOX', '[Gmail]/Sent Mail', etc. (default: INBOX)", default: 'INBOX' },
            markAsRead: { type: 'boolean', description: 'If true, marks the message as read (default: false)', default: false },
        },
        required: ['messageId'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { messageId, mailbox = 'INBOX', markAsRead = false } = input;

        logger.info(`Gmail: readEmail uid=${messageId}`);

        const { email, password } = await getGmailCreds();

        return await withImap(email, password, mailbox, async (client) => {
            const msg = await client.fetchOne(
                messageId,
                { source: true, envelope: true, flags: true, uid: true },
                { uid: true }
            );

            if (!msg) throw new Error(`Message not found: UID ${messageId}`);

            const parsed = await simpleParser(msg.source as Buffer);

            if (markAsRead) {
                await client.messageFlagsAdd(messageId, ['\\Seen'], { uid: true });
            }

            // Attachments: include base64 content only for small files (< 256 KB)
            const MAX_INLINE = 256 * 1024;
            const attachments = (parsed.attachments ?? []).map((a: any) => ({
                filename:    a.filename    ?? 'attachment',
                contentType: a.contentType ?? 'application/octet-stream',
                size:        a.size        ?? (a.content?.length ?? 0),
                content:     a.content && a.content.length <= MAX_INLINE
                    ? (a.content as Buffer).toString('base64')
                    : undefined,
                contentTruncated: a.content && a.content.length > MAX_INLINE ? true : undefined,
            }));

            return {
                id:              String(msg.uid),
                from:            msg.envelope?.from?.[0]?.address ?? parsed.from?.text ?? '',
                fromName:        msg.envelope?.from?.[0]?.name    ?? '',
                to:              (msg.envelope?.to ?? []).map((a: any) => a.address).join(', '),
                subject:         parsed.subject ?? '(no subject)',
                date:            (msg.envelope?.date ?? parsed.date)?.toISOString() ?? '',
                unread:          msg.flags ? !msg.flags.has('\\Seen') : true,
                body:            (parsed.text ?? (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]*>/g, '') : '')).substring(0, 5000),
                messageIdHeader: parsed.messageId   ?? null,
                inReplyTo:       parsed.inReplyTo   ?? null,
                attachments,
            };
        });
    },
});

// ── Tool: searchEmails ────────────────────────────────────────────────────

toolRegistry.register({
    name:        'gmail.searchEmails',
    description: "Search emails via Gmail query (e.g.: 'from:john subject:invoice is:unread')",
    inputSchema: {
        type: 'object',
        properties: {
            query:      { type: 'string', description: "Gmail query (e.g.: 'from:john@example.com', 'subject:invoice', 'after:2024/01/01 is:unread')" },
            maxResults: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 },
            mailbox:    { type: 'string', description: "Folder to search in (default: INBOX)", default: 'INBOX' },
        },
        required: ['query'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { query: q, maxResults = 10, mailbox = 'INBOX' } = input;

        logger.info(`Gmail: searchEmails query="${q}"`);

        const { email, password } = await getGmailCreds();
        const searchCriteria      = parseGmailQuery(q);

        const emails = await withImap(email, password, mailbox, async (client) => {
            const rawUids    = await client.search(searchCriteria, { uid: true });
            const uids       = rawUids === false ? [] : rawUids;
            const recentUids = uids.slice(-Math.min(maxResults, 50));

            if (recentUids.length === 0) return [];

            const results: any[] = [];
            for await (const msg of client.fetch(
                recentUids,
                { envelope: true, flags: true, uid: true },
                { uid: true }
            )) {
                results.push({
                    id:       String(msg.uid),
                    from:     msg.envelope?.from?.[0]?.address ?? '',
                    fromName: msg.envelope?.from?.[0]?.name    ?? '',
                    to:       (msg.envelope?.to ?? []).map((a: any) => a.address).join(', '),
                    subject:  msg.envelope?.subject ?? '(no subject)',
                    date:     msg.envelope?.date?.toISOString() ?? '',
                    unread:   msg.flags ? !msg.flags.has('\\Seen') : true,
                });
            }

            return results.reverse();
        });

        return { count: emails.length, query: q, emails };
    },
});

// ── Tool: sendEmail ───────────────────────────────────────────────────────

toolRegistry.register({
    name:        'gmail.sendEmail',
    description: 'Send a new email via Gmail (SMTP with App Password), with attachment support',
    inputSchema: {
        type: 'object',
        properties: {
            to:      { type: 'string', description: "Recipient (e.g.: 'john.doe@example.com')" },
            subject: { type: 'string', description: "Email subject" },
            body:    { type: 'string', description: "Email body in plain text" },
            cc:      { type: 'string', description: "CC recipients, comma-separated (optional)" },
            attachments: {
                type: 'array',
                description: 'List of attachments to include (optional)',
                items: {
                    type: 'object',
                    properties: {
                        filename:    { type: 'string', description: "Attachment file name (e.g.: report.pdf)" },
                        path:        { type: 'string', description: "Absolute file path on the server (e.g.: /app/workspace/report.pdf)" },
                        content:     { type: 'string', description: "File content encoded in base64 (alternative to path)" },
                        contentType: { type: 'string', description: "MIME type (e.g.: application/pdf) — auto-detected if omitted" },
                    },
                    required: ['filename'],
                },
            },
        },
        required: ['to', 'subject', 'body'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { to, subject, body, cc, attachments = [] } = input;

        logger.info(`Gmail: sendEmail to="${to}" subject="${subject}" attachments=${attachments.length}`);

        const { email, password } = await getGmailCreds();
        const transport           = createTransport(email, password);

        const builtAttachments = attachments.length > 0 ? buildAttachments(attachments) : undefined;

        const info = await transport.sendMail({
            from:        email,
            to,
            cc:          cc || undefined,
            subject,
            text:        body,
            attachments: builtAttachments,
        });

        return {
            success:     true,
            messageId:   info.messageId,
            message:     `Email sent successfully to ${to}${attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : ''}.`,
        };
    },
});

// ── Tool: replyEmail ──────────────────────────────────────────────────────

toolRegistry.register({
    name:        'gmail.replyEmail',
    description: 'Reply to an existing message in its Gmail thread, with attachment support',
    inputSchema: {
        type: 'object',
        properties: {
            messageId: { type: 'string',  description: "ID of the message to reply to (IMAP UID from listEmails)" },
            body:      { type: 'string',  description: "Reply text" },
            replyAll:  { type: 'boolean', description: 'If true, replies to all recipients (default: false)', default: false },
            mailbox:   { type: 'string',  description: "Folder of the original message (default: INBOX)", default: 'INBOX' },
            attachments: {
                type: 'array',
                description: 'List of attachments to include in the reply (optional)',
                items: {
                    type: 'object',
                    properties: {
                        filename:    { type: 'string', description: "Attachment file name" },
                        path:        { type: 'string', description: "Absolute file path on the server" },
                        content:     { type: 'string', description: "File content in base64 (alternative to path)" },
                        contentType: { type: 'string', description: "MIME type (optional)" },
                    },
                    required: ['filename'],
                },
            },
        },
        required: ['messageId', 'body'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { messageId, body, replyAll = false, mailbox = 'INBOX', attachments = [] } = input;

        logger.info(`Gmail: replyEmail to uid=${messageId}`);

        const { email, password } = await getGmailCreds();

        // Retrieve the original message metadata via IMAP
        const orig = await withImap(email, password, mailbox, async (client) => {
            const msg = await client.fetchOne(
                messageId,
                { source: true, envelope: true, uid: true },
                { uid: true }
            );
            if (!msg) throw new Error(`Message not found: UID ${messageId}`);

            const parsed = await simpleParser(msg.source as Buffer);
            return {
                from:       msg.envelope?.from?.[0]?.address ?? '',
                toAll:      [
                    ...(msg.envelope?.to  ?? []).map((a: any) => a.address),
                    ...(msg.envelope?.cc  ?? []).map((a: any) => a.address),
                ].filter(a => a && a !== email),
                subject:    parsed.subject    ?? '',
                msgId:      parsed.messageId  ?? '',
                references: Array.isArray(parsed.references)
                    ? (parsed.references as string[]).join(' ')
                    : (parsed.references ?? ''),
            };
        });

        const replyTo   = replyAll ? [orig.from, ...orig.toAll].join(', ') : orig.from;
        const reSubject = orig.subject.startsWith('Re:') ? orig.subject : `Re: ${orig.subject}`;

        const transport        = createTransport(email, password);
        const builtAttachments = attachments.length > 0 ? buildAttachments(attachments) : undefined;

        const info = await transport.sendMail({
            from:        email,
            to:          replyTo,
            subject:     reSubject,
            text:        body,
            attachments: builtAttachments,
            headers: {
                'In-Reply-To': orig.msgId,
                'References':  [orig.references, orig.msgId].filter(Boolean).join(' '),
            },
        });

        return {
            success:   true,
            messageId: info.messageId,
            message:   `Reply sent successfully to ${replyTo}${attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : ''}.`,
        };
    },
});

// ── Tool: getAttachment ───────────────────────────────────────────────────

toolRegistry.register({
    name:        'gmail.getAttachment',
    description: 'Download an attachment from a received email and save it to the filesystem (or return it in base64)',
    inputSchema: {
        type: 'object',
        properties: {
            messageId: { type: 'string', description: "Message ID (IMAP UID from listEmails or readEmail)" },
            filename:  { type: 'string', description: "Name of the attachment file to extract (as shown in readEmail)" },
            savePath:  { type: 'string', description: "Path where to save the file on the server (e.g.: /app/workspace/attachment.pdf). If omitted, returns the content in base64." },
            mailbox:   { type: 'string', description: "Message folder (default: INBOX)", default: 'INBOX' },
        },
        required: ['messageId', 'filename'],
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const { messageId, filename, savePath, mailbox = 'INBOX' } = input;

        logger.info(`Gmail: getAttachment uid=${messageId} filename="${filename}"`);

        const { email, password } = await getGmailCreds();

        return await withImap(email, password, mailbox, async (client) => {
            const msg = await client.fetchOne(
                messageId,
                { source: true, uid: true },
                { uid: true }
            );
            if (!msg) throw new Error(`Message not found: UID ${messageId}`);

            const parsed = await simpleParser(msg.source as Buffer);

            const att = (parsed.attachments ?? []).find(
                (a: any) => a.filename === filename
            );
            if (!att) {
                const available = (parsed.attachments ?? []).map((a: any) => a.filename).join(', ');
                throw new Error(`Attachment "${filename}" not found. Available attachments: ${available || 'none'}`);
            }

            if (savePath) {
                const resolved = path.resolve(savePath);
                const dir      = path.dirname(resolved);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(resolved, att.content as Buffer);
                return {
                    success:     true,
                    savedTo:     resolved,
                    filename:    att.filename,
                    contentType: att.contentType,
                    size:        (att.content as Buffer).length,
                };
            } else {
                return {
                    success:     true,
                    filename:    att.filename,
                    contentType: att.contentType,
                    size:        (att.content as Buffer).length,
                    content:     (att.content as Buffer).toString('base64'),
                };
            }
        });
    },
});
