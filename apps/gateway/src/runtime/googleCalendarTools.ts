// Copyright (c) 2026 Flavio Cerato
import { toolRegistry } from './toolRegistry.js';
import { logger } from '../util/logger.js';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import crypto from 'node:crypto';

logger.info('googleCalendarTools module loaded (CalDAV raw HTTP)');

// Google CalDAV endpoints to try (in order of preference)
const CALDAV_ENDPOINTS = [
    'https://apidata.googleusercontent.com/caldav/v2',
    'https://www.google.com/calendar/dav',
];

// Cached working endpoint (discovered at first successful request)
let _workingEndpoint: string | null = null;

// ── Credential helper ─────────────────────────────────────────────────────

async function getGoogleCreds(): Promise<{ email: string; password: string }> {
    const res = await query(
        "SELECT key, ciphertext FROM secrets WHERE key IN ('google.email', 'google.app_password')"
    );
    const creds: Record<string, string> = {};
    for (const row of res.rows) {
        try { creds[row.key] = JSON.parse(decrypt(row.ciphertext as string)); } catch { }
    }
    if (!creds['google.email'])
        throw new Error('Missing credential: "google.email". Configure the Gmail connector in the Connectors panel.');
    if (!creds['google.app_password'])
        throw new Error('Missing credential: "google.app_password". Configure the Gmail connector in the Connectors panel.');
    return { email: creds['google.email'], password: creds['google.app_password'] };
}

// ── CalDAV HTTP primitives ────────────────────────────────────────────────

function calendarUrl(baseEndpoint: string, email: string): string {
    // Don't encode the @ in the email — Google CalDAV expects the raw email
    return `${baseEndpoint}/${email}/events/`;
}

function eventUrlFromBase(baseEndpoint: string, email: string, uid: string): string {
    return `${baseEndpoint}/${email}/events/${uid}.ics`;
}

function authHeader(email: string, password: string): string {
    return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

/** Discover working CalDAV endpoint (tries all endpoints, caches the result) */
async function discoverEndpoint(email: string, password: string): Promise<string> {
    if (_workingEndpoint) return _workingEndpoint;

    const auth = authHeader(email, password);

    for (const ep of CALDAV_ENDPOINTS) {
        const url = calendarUrl(ep, email);
        logger.info(`CalDAV: testing endpoint ${url}`);
        try {
            const res = await fetch(url, {
                method:  'PROPFIND',
                headers: {
                    'Authorization': auth,
                    'Content-Type':  'application/xml; charset=utf-8',
                    'Depth':         '0',
                },
                body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
                redirect: 'follow',
            });
            logger.info(`CalDAV: endpoint ${ep} → HTTP ${res.status}`);
            if (res.status < 400) {
                _workingEndpoint = ep;
                return ep;
            }
        } catch (e: any) {
            logger.warn(`CalDAV: endpoint ${ep} failed: ${e.message}`);
        }
    }

    throw new Error(
        'No Google CalDAV endpoint accepted the credentials. ' +
        'Verify that the App Password is correct and that Google Calendar is active.'
    );
}

/** REPORT: list events in a time range */
async function caldavReport(
    email: string,
    password: string,
    start: Date,
    end: Date
): Promise<Array<{ url: string; etag: string; data: string }>> {
    const ep  = await discoverEndpoint(email, password);
    const url = calendarUrl(ep, email);

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">',
        '  <d:prop>',
        '    <d:getetag/>',
        '    <c:calendar-data/>',
        '  </d:prop>',
        '  <c:filter>',
        '    <c:comp-filter name="VCALENDAR">',
        '      <c:comp-filter name="VEVENT">',
        `        <c:time-range start="${fmtICal(start)}" end="${fmtICal(end)}"/>`,
        '      </c:comp-filter>',
        '    </c:comp-filter>',
        '  </c:filter>',
        '</c:calendar-query>',
    ].join('\n');

    const res = await fetch(url, {
        method: 'REPORT',
        headers: {
            'Authorization': authHeader(email, password),
            'Content-Type':  'application/xml; charset=utf-8',
            'Depth':         '1',
        },
        body: xml,
    });

    if (res.status >= 400) {
        const text = await res.text();
        throw new Error(`CalDAV REPORT failed (HTTP ${res.status}): ${text.substring(0, 500)}`);
    }

    return parseMultistatus(await res.text());
}

/** GET: fetch a single event by full URL */
async function caldavGet(
    email: string,
    password: string,
    eventUrl: string
): Promise<{ url: string; etag: string; data: string }> {
    const res = await fetch(eventUrl, {
        method:  'GET',
        headers: { 'Authorization': authHeader(email, password) },
        redirect: 'follow',
    });
    if (res.status >= 400) {
        throw new Error(`Event not found (HTTP ${res.status})`);
    }
    return {
        url:  eventUrl,
        etag: (res.headers.get('etag') ?? '').replace(/"/g, ''),
        data: await res.text(),
    };
}

/** PUT: create or update an event */
async function caldavPut(
    email: string,
    password: string,
    url: string,
    ical: string,
    etag?: string
): Promise<void> {
    const headers: Record<string, string> = {
        'Authorization': authHeader(email, password),
        'Content-Type':  'text/calendar; charset=utf-8',
    };
    if (etag) {
        headers['If-Match'] = etag.startsWith('"') ? etag : `"${etag}"`;
    } else {
        headers['If-None-Match'] = '*'; // create only, don't overwrite
    }

    const res = await fetch(url, { method: 'PUT', headers, body: ical });
    if (res.status >= 400) {
        const text = await res.text();
        throw new Error(`CalDAV PUT failed (HTTP ${res.status}): ${text.substring(0, 500)}`);
    }
}

/** DELETE: remove an event */
async function caldavDelete(
    email: string,
    password: string,
    url: string,
    etag?: string
): Promise<void> {
    const headers: Record<string, string> = {
        'Authorization': authHeader(email, password),
    };
    if (etag) headers['If-Match'] = etag.startsWith('"') ? etag : `"${etag}"`;

    const res = await fetch(url, { method: 'DELETE', headers });
    if (res.status >= 400) {
        const text = await res.text();
        throw new Error(`CalDAV DELETE failed (HTTP ${res.status}): ${text.substring(0, 500)}`);
    }
}

// ── XML response parser ──────────────────────────────────────────────────

function unescapeXml(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g,  '<')
        .replace(/&gt;/g,  '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/** Parse CalDAV multistatus XML → array of {url, etag, data} */
function parseMultistatus(xml: string): Array<{ url: string; etag: string; data: string }> {
    const results: Array<{ url: string; etag: string; data: string }> = [];

    // Split on <response> (handles various namespace prefixes)
    const blocks = xml.split(/<(?:[a-zA-Z]+:)?response[\s>]/);

    for (let i = 1; i < blocks.length; i++) {
        const b = blocks[i];

        const hrefMatch = b.match(/<(?:[a-zA-Z]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z]+:)?href>/i);
        const etagMatch = b.match(/<(?:[a-zA-Z]+:)?getetag[^>]*>"?([^"<]+)"?<\/(?:[a-zA-Z]+:)?getetag>/i);
        const dataMatch = b.match(/<(?:[a-zA-Z]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?calendar-data>/i);

        const href = hrefMatch?.[1]?.trim() ?? '';
        const etag = etagMatch?.[1]?.trim() ?? '';
        const data = unescapeXml(dataMatch?.[1]?.trim() ?? '');

        if (href && data) {
            // href from Google is a path like /caldav/v2/email/events/uid.ics
            // or /calendar/dav/email/events/uid.ics
            // Reconstruct full URL from the working endpoint host
            let fullUrl: string;
            if (href.startsWith('http')) {
                fullUrl = href;
            } else {
                // Extract the host from the working endpoint or fallback
                const host = (_workingEndpoint ?? CALDAV_ENDPOINTS[0]).replace(/\/caldav\/v2$|\/calendar\/dav$/, '');
                fullUrl = `${host}${href}`;
            }
            results.push({ url: fullUrl, etag, data });
        }
    }

    return results;
}

// ── iCal helpers ──────────────────────────────────────────────────────────

function fmtICal(d: Date): string {
    return d.toISOString().replace(/[-:.]/g, '').replace(/(\d{8}T\d{6})\d{3}Z/, '$1Z');
}

function escICal(s: string): string {
    return (s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function unescICal(s: string): string {
    return (s ?? '').replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function buildICalString(
    uid: string, summary: string,
    dtstart: Date, dtend: Date,
    description?: string, location?: string
): string {
    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//9Lives//CalDAV//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${fmtICal(new Date())}`,
        `DTSTART:${fmtICal(dtstart)}`,
        `DTEND:${fmtICal(dtend)}`,
        `SUMMARY:${escICal(summary)}`,
    ];
    if (description) lines.push(`DESCRIPTION:${escICal(description)}`);
    if (location)    lines.push(`LOCATION:${escICal(location)}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}

interface ParsedEvent {
    id: string;
    uid: string;
    summary: string;
    description: string;
    location: string;
    start: Date;
    end: Date;
    allDay: boolean;
    etag?: string;
}

function parseICalEvent(data: string, url: string, etag?: string): ParsedEvent | null {
    const text = data.replace(/\r?\n[ \t]/g, '');

    const getVal = (key: string): string => {
        const m = text.match(new RegExp(`(?:^|\\n)${key}(?:;[^:]*)?:([^\\r\\n]*)`, 'm'));
        return m ? m[1].trim() : '';
    };

    const parseDT = (key: string): { date: Date; allDay: boolean } => {
        const m = text.match(new RegExp(`(?:^|\\n)${key}(;[^:]*)?:([^\\r\\n]+)`, 'm'));
        if (!m) return { date: new Date(), allDay: false };
        const params = m[1] ?? '';
        const val    = m[2].trim();

        if (params.includes('VALUE=DATE') || /^\d{8}$/.test(val)) {
            return { date: new Date(`${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T00:00:00`), allDay: true };
        }
        const y = val.slice(0, 4), mo = val.slice(4, 6), d = val.slice(6, 8);
        const h = val.slice(9, 11), mi = val.slice(11, 13), s = val.slice(13, 15);
        return { date: new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${val.endsWith('Z') ? 'Z' : ''}`), allDay: false };
    };

    const uid = getVal('UID');
    if (!uid) return null;

    const { date: start, allDay } = parseDT('DTSTART');
    const { date: end }           = parseDT('DTEND');

    return {
        id: url, uid,
        summary:     unescICal(getVal('SUMMARY')),
        description: unescICal(getVal('DESCRIPTION')),
        location:    unescICal(getVal('LOCATION')),
        start, end, allDay, etag,
    };
}

function toOutput(e: ParsedEvent) {
    return {
        id:          e.id,
        summary:     e.summary,
        description: e.description || null,
        location:    e.location    || null,
        start:       e.start.toISOString(),
        end:         e.end.toISOString(),
        allDay:      e.allDay,
    };
}

// ── Timezone helpers (for findFreeSlots) ─────────────────────────────────

function getLocalDateStr(utcDate: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(utcDate);
}

function localHourToUTC(localDateStr: string, hour: number, tz: string): Date {
    const approx   = new Date(`${localDateStr}T${String(hour).padStart(2, '0')}:00:00Z`);
    const utcStr   = approx.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr    = approx.toLocaleString('en-US', { timeZone: tz });
    const offsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
    return new Date(approx.getTime() - offsetMs);
}

// ── Tool: listEvents ──────────────────────────────────────────────────────

toolRegistry.register({
    name:        'google_calendar.listEvents',
    description: 'List Google Calendar events in a date range',
    inputSchema: {
        type: 'object',
        properties: {
            startDateTime: { type: 'string', description: "Start date/time ISO 8601 (default: today)" },
            endDateTime:   { type: 'string', description: "End date/time ISO 8601 (default: +7 days)" },
            maxResults:    { type: 'number', description: 'Maximum number of events (default: 25)', default: 25 },
        },
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const now   = new Date();
        const start = new Date(input.startDateTime ?? now.toISOString());
        const end   = new Date(input.endDateTime   ?? new Date(now.getTime() + 7 * 86400000).toISOString());
        const max   = input.maxResults ?? 25;

        logger.info(`GCalendar: listEvents ${start.toISOString()} → ${end.toISOString()}`);
        const { email, password } = await getGoogleCreds();

        const objects = await caldavReport(email, password, start, end);
        const events  = objects
            .map(o => parseICalEvent(o.data, o.url, o.etag))
            .filter((e): e is ParsedEvent => e !== null)
            .sort((a, b) => a.start.getTime() - b.start.getTime())
            .slice(0, max);

        return { count: events.length, events: events.map(toOutput) };
    },
});

// ── Tool: createEvent ─────────────────────────────────────────────────────

toolRegistry.register({
    name:        'google_calendar.createEvent',
    description: 'Create a new event in Google Calendar',
    inputSchema: {
        type: 'object',
        properties: {
            summary:       { type: 'string', description: "Event title" },
            startDateTime: { type: 'string', description: "Start date/time ISO 8601 (e.g.: '2024-01-15T10:00:00')" },
            endDateTime:   { type: 'string', description: "End date/time ISO 8601 (e.g.: '2024-01-15T11:00:00')" },
            description:   { type: 'string', description: "Description (optional)" },
            location:      { type: 'string', description: "Location (optional)" },
        },
        required: ['summary', 'startDateTime', 'endDateTime'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { summary, startDateTime, endDateTime, description, location } = input;
        const uid  = crypto.randomUUID();
        const ical = buildICalString(uid, summary, new Date(startDateTime), new Date(endDateTime), description, location);

        logger.info(`GCalendar: createEvent "${summary}"`);
        const { email, password } = await getGoogleCreds();

        const ep  = await discoverEndpoint(email, password);
        const url = eventUrlFromBase(ep, email, uid);
        await caldavPut(email, password, url, ical);

        return { success: true, id: url, message: `Event "${summary}" created successfully.` };
    },
});

// ── Tool: updateEvent ─────────────────────────────────────────────────────

toolRegistry.register({
    name:        'google_calendar.updateEvent',
    description: 'Update an existing event in Google Calendar',
    inputSchema: {
        type: 'object',
        properties: {
            eventId:       { type: 'string', description: "Event ID (CalDAV URL returned by listEvents)" },
            summary:       { type: 'string', description: "New title (optional)" },
            startDateTime: { type: 'string', description: "New start date/time ISO 8601 (optional)" },
            endDateTime:   { type: 'string', description: "New end date/time ISO 8601 (optional)" },
            description:   { type: 'string', description: "New description (optional)" },
            location:      { type: 'string', description: "New location (optional)" },
        },
        required: ['eventId'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { eventId, summary, startDateTime, endDateTime, description, location } = input;

        logger.info(`GCalendar: updateEvent "${eventId}"`);
        const { email, password } = await getGoogleCreds();

        // Fetch the current event to get etag + existing data
        const current  = await caldavGet(email, password, eventId);
        const existing = parseICalEvent(current.data, current.url, current.etag);
        if (!existing) throw new Error("Unable to read the existing event.");

        const ical = buildICalString(
            existing.uid,
            summary       ?? existing.summary,
            startDateTime ? new Date(startDateTime) : existing.start,
            endDateTime   ? new Date(endDateTime)   : existing.end,
            description   ?? existing.description ?? undefined,
            location      ?? existing.location    ?? undefined,
        );

        await caldavPut(email, password, eventId, ical, current.etag);
        return { success: true, message: 'Event updated successfully.' };
    },
});

// ── Tool: deleteEvent ─────────────────────────────────────────────────────

toolRegistry.register({
    name:        'google_calendar.deleteEvent',
    description: 'Delete an event from Google Calendar',
    inputSchema: {
        type: 'object',
        properties: {
            eventId: { type: 'string', description: "ID of the event to delete (CalDAV URL from listEvents)" },
        },
        required: ['eventId'],
    },
    sideEffecting: true,
    handler: async (_ctx, input) => {
        const { eventId } = input;

        logger.info(`GCalendar: deleteEvent "${eventId}"`);
        const { email, password } = await getGoogleCreds();

        // Fetch etag first for safe delete
        const current = await caldavGet(email, password, eventId);
        await caldavDelete(email, password, eventId, current.etag);

        return { success: true, message: 'Event deleted successfully.' };
    },
});

// ── Tool: findFreeSlots ───────────────────────────────────────────────────

toolRegistry.register({
    name:        'google_calendar.findFreeSlots',
    description: 'Find free time slots in Google Calendar respecting working hours',
    inputSchema: {
        type: 'object',
        properties: {
            startDateTime:       { type: 'string', description: "Search start date/time ISO 8601 (default: tomorrow)" },
            endDateTime:         { type: 'string', description: "Search end date/time ISO 8601 (default: +7 days)" },
            slotDurationMinutes: { type: 'number', description: "Minimum free slot duration in minutes (default: 30)", default: 30 },
            workdayStartHour:    { type: 'number', description: "Local workday start hour (default: 9)",  default: 9 },
            workdayEndHour:      { type: 'number', description: "Local workday end hour (default: 18)", default: 18 },
            timeZone:            { type: 'string', description: "Time zone (default: Europe/Rome)", default: 'Europe/Rome' },
        },
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const now      = new Date();
        const tomorrow = new Date(now.getTime() + 86400000);

        const startDateTime       = input.startDateTime       ?? tomorrow.toISOString().split('T')[0] + 'T00:00:00Z';
        const endDateTime         = input.endDateTime         ?? new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0] + 'T23:59:59Z';
        const slotDurationMinutes = input.slotDurationMinutes ?? 30;
        const workdayStartHour    = input.workdayStartHour    ?? 9;
        const workdayEndHour      = input.workdayEndHour      ?? 18;
        const timeZone            = input.timeZone            ?? 'Europe/Rome';

        logger.info(`GCalendar: findFreeSlots ${startDateTime} → ${endDateTime} (tz: ${timeZone})`);

        const { email, password } = await getGoogleCreds();
        const slotMs = slotDurationMinutes * 60 * 1000;

        const objects = await caldavReport(email, password, new Date(startDateTime), new Date(endDateTime));
        const busyPeriods = objects
            .map(o => parseICalEvent(o.data, o.url))
            .filter((e): e is ParsedEvent => e !== null)
            .map(e => ({ start: e.start.getTime(), end: e.end.getTime() }));

        const rangeStart   = new Date(startDateTime);
        const rangeEnd     = new Date(endDateTime);
        const freeSlots: Array<{ start: string; end: string; durationMinutes: number }> = [];

        let curLocalDate     = getLocalDateStr(rangeStart, timeZone);
        const endLocalDate   = getLocalDateStr(rangeEnd, timeZone);

        while (curLocalDate <= endLocalDate) {
            const windowStart = localHourToUTC(curLocalDate, workdayStartHour, timeZone);
            const windowEnd   = localHourToUTC(curLocalDate, workdayEndHour,   timeZone);
            const effStart    = windowStart < rangeStart ? rangeStart : windowStart;
            const effEnd      = windowEnd   > rangeEnd   ? rangeEnd   : windowEnd;

            if (effStart < effEnd) {
                const dayBusy = busyPeriods
                    .filter(b => b.end > effStart.getTime() && b.start < effEnd.getTime())
                    .sort((a, b) => a.start - b.start);

                let pointer = effStart.getTime();

                for (const busy of dayBusy) {
                    const gapEnd = Math.min(busy.start, effEnd.getTime());
                    if (gapEnd - pointer >= slotMs) {
                        freeSlots.push({
                            start:           new Date(pointer).toISOString(),
                            end:             new Date(gapEnd).toISOString(),
                            durationMinutes: Math.floor((gapEnd - pointer) / 60000),
                        });
                    }
                    pointer = Math.max(pointer, busy.end);
                }

                if (effEnd.getTime() - pointer >= slotMs) {
                    freeSlots.push({
                        start:           new Date(pointer).toISOString(),
                        end:             effEnd.toISOString(),
                        durationMinutes: Math.floor((effEnd.getTime() - pointer) / 60000),
                    });
                }
            }

            const nextDay = new Date(localHourToUTC(curLocalDate, 12, timeZone));
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            curLocalDate = getLocalDateStr(nextDay, timeZone);
        }

        return {
            startDateTime, endDateTime, timeZone,
            slotDurationMinutes, workdayStartHour, workdayEndHour,
            count: freeSlots.length,
            freeSlots,
        };
    },
});
