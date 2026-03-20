// Copyright (c) 2026 Flavio Cerato
import { query } from '../storage/pg/pool.js';

export type LiveCandidate = {
    id: string;
    name: string;
    description: string;
    system_prompt?: string;
    skills: string[];
    routing_default: boolean;
};

type CrewCandidate = {
    id: string;
    name: string;
    description: string;
    system_prompt: string;
    member_live_ids: string[];
    member_search_text?: string;
    routing_default: boolean;
};

type CandidateBase = {
    id: string;
    name: string;
    description: string;
    routing_default: boolean;
    searchText: string;
};

type RoutedReason = 'mention' | 'score' | 'channel_default' | 'global_default';

export type RoutedTarget = {
    kind: 'live' | 'crew';
    id: string;
    cleanedMessage: string;
    reason: RoutedReason;
};

export type RankedLiveCandidate = {
    live: LiveCandidate;
    score: number;
};

const STOPWORDS = new Set([
    'come', 'sono', 'deve', 'devi', 'della', 'dello', 'delle', 'degli', 'dell',
    'alla', 'allo', 'alle', 'agli', 'anche', 'questo', 'questa', 'quello', 'quella',
    'dopo', 'prima', 'dentro', 'fuori', 'senza', 'nella', 'nelle', 'negli', 'nello',
    'con', 'per', 'tra', 'fra', 'una', 'uno', 'gli', 'dei', 'del', 'dai', 'dalle',
    'che', 'chi', 'non', 'piu', 'puo', 'puoi', 'fare', 'fai', 'voglio', 'vorrei',
    'ciao', 'salve', 'hello', 'please', 'agent', 'agente', 'assistente'
]);

function normalizeText(value: string) {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAliases(candidate: Pick<CandidateBase, 'id' | 'name'>) {
    const raw = [candidate.id, candidate.name]
        .map((item) => normalizeText(item))
        .filter(Boolean);
    return Array.from(new Set(raw));
}

function stripLeadingMention(message: string, alias: string) {
    const aliasPattern = escapeRegex(alias).replace(/\s+/g, '\\s+');
    const patterns = [
        new RegExp(`^\\s*@?${aliasPattern}\\s*[:,\\-]\\s*`, 'i'),
        new RegExp(`^\\s*@?${aliasPattern}\\s+`, 'i'),
    ];

    let cleaned = message;
    for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.trim() || message.trim();
}

function getKeywords(candidate: CandidateBase) {
    const words = normalizeText(candidate.searchText)
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
    return Array.from(new Set(words)).slice(0, 32);
}

function scoreCandidate(candidate: CandidateBase, normalizedMessage: string) {
    let score = 0;
    const aliases = buildAliases(candidate);

    for (const alias of aliases) {
        if (!alias) continue;
        if (normalizedMessage.includes(alias.replace(/\s+/g, ' '))) {
            score += alias.includes(' ') ? 20 : 12;
        }
    }

    for (const keyword of getKeywords(candidate)) {
        if (normalizedMessage.includes(keyword)) {
            score += 3;
        }
    }

    if (candidate.routing_default) {
        score += 1;
    }

    return score;
}

function findMentionedCandidate<T extends CandidateBase>(candidates: T[], message: string) {
    const trimmedMessage = message.trim();

    for (const candidate of candidates) {
        for (const alias of buildAliases(candidate)) {
            if (!alias) continue;
            const aliasPattern = escapeRegex(alias).replace(/\s+/g, '\\s+');
            const mentionPatterns = [
                new RegExp(`^\\s*@${aliasPattern}(?=\\s|[:,\\-]|$)`, 'i'),
                new RegExp(`^\\s*${aliasPattern}(?=\\s*[:,\\-]|\\s|$)`, 'i'),
            ];

            if (mentionPatterns.some((pattern) => pattern.test(trimmedMessage))) {
                return {
                    candidate,
                    cleanedMessage: stripLeadingMention(trimmedMessage, alias),
                    reason: 'mention' as const,
                };
            }
        }
    }

    return null;
}

function routeWithinCandidates<T extends CandidateBase>(candidates: T[], message: string) {
    if (candidates.length === 0) {
        return null;
    }

    const explicit = findMentionedCandidate(candidates, message);
    if (explicit) {
        return explicit;
    }

    const normalizedMessage = normalizeText(message);
    const ranked = candidates
        .map((candidate) => ({ candidate, score: scoreCandidate(candidate, normalizedMessage) }))
        .sort((a, b) => b.score - a.score);

    if (ranked[0] && ranked[0].score > 0) {
        return {
            candidate: ranked[0].candidate,
            cleanedMessage: message.trim(),
            reason: 'score' as const,
        };
    }

    return {
        candidate: candidates[0],
        cleanedMessage: message.trim(),
        reason: 'channel_default' as const,
    };
}

function asCrewSearchText(crew: CrewCandidate) {
    return `${crew.name} ${crew.id} ${crew.description} ${crew.system_prompt || ''} ${crew.member_search_text || ''} ${(crew.member_live_ids || []).join(' ')}`;
}

function asLiveSearchText(live: LiveCandidate) {
    return `${live.name} ${live.id} ${live.description} ${live.system_prompt || ''} ${(live.skills || []).join(' ')}`;
}

async function loadCrewCandidatesForChannel(channelTag: string): Promise<CrewCandidate[]> {
    const channelSpec = JSON.stringify([channelTag]);
    const res = await query(
        `SELECT id, name, description, system_prompt, member_live_ids, routing_default
         FROM crews
         WHERE channels @> $1::jsonb
        ORDER BY routing_default DESC, created_at ASC`,
        [channelSpec]
    );
    const crews = res.rows as CrewCandidate[];
    const memberIds = Array.from(new Set(crews.flatMap((crew) => crew.member_live_ids || [])));

    if (memberIds.length === 0) {
        return crews;
    }

    const memberRes = await query(
        `SELECT id, name, description, system_prompt, skills
         FROM lives
         WHERE id = ANY($1::text[])`,
        [memberIds]
    );
    const memberMap = new Map(
        memberRes.rows.map((row: any) => [
            row.id,
            `${row.id} ${row.name} ${row.description || ''} ${row.system_prompt || ''} ${Array.isArray(row.skills) ? row.skills.join(' ') : ''}`
        ])
    );

    return crews.map((crew) => ({
        ...crew,
        member_search_text: (crew.member_live_ids || [])
            .map((id) => memberMap.get(id) || id)
            .join(' ')
    }));
}

async function loadLiveCandidatesForChannel(channelTag: string): Promise<LiveCandidate[]> {
    const channelSpec = JSON.stringify([channelTag]);
    const res = await query(
        `SELECT id, name, description, system_prompt, skills, routing_default
         FROM lives
         WHERE channels @> $1::jsonb
         ORDER BY routing_default DESC, created_at ASC`,
        [channelSpec]
    );
    return res.rows as LiveCandidate[];
}

async function loadGlobalDefaultCrew(): Promise<CrewCandidate | null> {
    const res = await query(
        `SELECT id, name, description, system_prompt, member_live_ids, routing_default
         FROM crews
         WHERE routing_default = true
         ORDER BY created_at ASC
         LIMIT 1`
    );
    return (res.rows[0] as CrewCandidate | undefined) ?? null;
}

async function loadGlobalDefaultLive(): Promise<LiveCandidate | null> {
    const res = await query(
        `SELECT id, name, description, system_prompt, skills, routing_default
         FROM lives
         WHERE routing_default = true
         ORDER BY created_at ASC
         LIMIT 1`
    );
    return (res.rows[0] as LiveCandidate | undefined) ?? null;
}

export function rankLiveCandidates(lives: LiveCandidate[], message: string): RankedLiveCandidate[] {
    const normalizedMessage = normalizeText(message);
    return lives
        .map((live) => ({
            live,
            score: scoreCandidate(
                {
                    ...live,
                    searchText: asLiveSearchText(live),
                },
                normalizedMessage
            )
        }))
        .sort((a, b) => b.score - a.score);
}

export function selectBestLiveCandidate(lives: LiveCandidate[], message: string): { live: LiveCandidate; cleanedMessage: string; reason: Exclude<RoutedReason, 'global_default'> } | null {
    const routed = routeWithinCandidates(
        lives.map((live) => ({
            ...live,
            searchText: asLiveSearchText(live),
        })),
        message
    );

    if (!routed) {
        return null;
    }

    const selected = lives.find((live) => live.id === routed.candidate.id);
    if (!selected) {
        return null;
    }

    return {
        live: selected,
        cleanedMessage: routed.cleanedMessage,
        reason: routed.reason,
    };
}

export async function routeTargetForIncomingMessage(channelTag: string, message: string): Promise<RoutedTarget | null> {
    const crewCandidates = await loadCrewCandidatesForChannel(channelTag);
    if (crewCandidates.length > 0) {
        const routedCrew = routeWithinCandidates(
            crewCandidates.map((crew) => ({
                ...crew,
                searchText: asCrewSearchText(crew),
            })),
            message
        );
        if (routedCrew) {
            return {
                kind: 'crew',
                id: routedCrew.candidate.id,
                cleanedMessage: routedCrew.cleanedMessage,
                reason: routedCrew.reason,
            };
        }
    }

    const liveCandidates = await loadLiveCandidatesForChannel(channelTag);
    if (liveCandidates.length > 0) {
        const routedLive = selectBestLiveCandidate(liveCandidates, message);
        if (routedLive) {
            return {
                kind: 'live',
                id: routedLive.live.id,
                cleanedMessage: routedLive.cleanedMessage,
                reason: routedLive.reason,
            };
        }
    }

    const defaultCrew = await loadGlobalDefaultCrew();
    if (defaultCrew) {
        return {
            kind: 'crew',
            id: defaultCrew.id,
            cleanedMessage: message.trim(),
            reason: 'global_default',
        };
    }

    const defaultLive = await loadGlobalDefaultLive();
    if (defaultLive) {
        return {
            kind: 'live',
            id: defaultLive.id,
            cleanedMessage: message.trim(),
            reason: 'global_default',
        };
    }

    return null;
}

export async function routeLiveForIncomingMessage(channelTag: string, message: string) {
    const routed = await routeTargetForIncomingMessage(channelTag, message);
    if (!routed || routed.kind !== 'live') {
        return null;
    }

    return {
        liveId: routed.id,
        cleanedMessage: routed.cleanedMessage,
        reason: routed.reason,
    };
}
