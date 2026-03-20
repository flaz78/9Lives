// Copyright (c) 2026 Flavio Cerato
import OpenAI from 'openai';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import { runLive, type RunOptions } from './orchestrator.js';
import { selectBestLiveCandidate, rankLiveCandidates, type LiveCandidate } from './channelRouter.js';

type CrewRecord = {
    id: string;
    name: string;
    description: string;
    system_prompt: string;
    member_live_ids: string[];
    orchestration_mode: 'router_only' | 'pipeline' | 'supervisor_llm';
    llm_config_id: string | null;
    model_name: string;
};

type SupervisorPlan = {
    steps: Array<{
        liveId: string;
        task: string;
        kind?: 'research' | 'draft' | 'delivery' | 'other';
    }>;
};

type NormalizedSupervisorStep = {
    liveId: string;
    task: string;
    kind: 'research' | 'draft' | 'delivery' | 'other';
};

type MemberToolOutput = {
    toolName: string;
    args: any;
    result: any;
};

type MemberRunResult = {
    response: string;
    toolOutputs: MemberToolOutput[];
};

type StageKind = 'research' | 'draft' | 'delivery' | 'other';

export interface RunCrewOptions extends Omit<RunOptions, 'liveId'> {
    crewId: string;
}

const MAX_MEMBER_ATTEMPTS = 3;
const MAX_SUPERVISOR_STEPS = 4;
const MIN_DRAFT_CONTENT_CHARS = 600;
const MAX_HANDOFF_CHARS = 18_000;
const CREW_MEMORY_EXCHANGES_LIMIT = 10;
const CREW_MEMORY_MESSAGE_LIMIT = CREW_MEMORY_EXCHANGES_LIMIT * 2;

function inferStepKind(task: string): StageKind {
    const normalized = task.toLowerCase();
    if (/(search|research|cerca|ricerca|find sources|browse|web|fonti|news)/.test(normalized)) {
        return 'research';
    }
    if (/(write|draft|scrivi|redigi|sintetizza|report|article|rassegna|documento|compose)/.test(normalized)) {
        return 'draft';
    }
    if (/(send|email|upload|save file|salva|carica|drive|gmail|deliver|publish|invia)/.test(normalized)) {
        return 'delivery';
    }
    return 'other';
}

function buildPipelineStageKinds(totalStages: number, userMessage: string): StageKind[] {
    if (totalStages <= 0) {
        return [];
    }

    if (totalStages === 1) {
        return [inferStepKind(userMessage)];
    }

    const wantsResearch = /(search|research|cerca|ricerca|browse|web|fonti|news|articoli|article|read sources)/i.test(userMessage);
    const wantsDelivery = /(send|email|upload|save|salva|carica|drive|gmail|deliver|publish|invia)/i.test(userMessage);
    const kinds: Array<StageKind | null> = new Array(totalStages).fill(null);

    let startIndex = 0;
    let endIndex = totalStages - 1;

    if (wantsResearch) {
        kinds[0] = 'research';
        startIndex = 1;
    }

    if (wantsDelivery && endIndex >= startIndex) {
        kinds[endIndex] = 'delivery';
        endIndex -= 1;
    }

    for (let index = startIndex; index <= endIndex; index++) {
        kinds[index] = 'draft';
    }

    return kinds.map((kind) => kind ?? 'other');
}

function compactSupervisorSteps(steps: NormalizedSupervisorStep[]) {
    const compacted: NormalizedSupervisorStep[] = [];

    for (const step of steps) {
        const previous = compacted[compacted.length - 1];
        if (
            previous &&
            previous.liveId === step.liveId &&
            previous.kind === step.kind
        ) {
            previous.task = `${previous.task}\n- ${step.task}`;
            continue;
        }
        compacted.push({ ...step });
    }

    return compacted;
}

function looksOperationalOnly(text: string) {
    const normalized = text.toLowerCase();
    return (
        /file created|saved file|uploaded|email sent|document created|drive upload|gmail:|filesystem:/i.test(normalized) &&
        text.length < MIN_DRAFT_CONTENT_CHARS
    );
}

function collectArtifactPaths(toolOutputs: MemberToolOutput[]) {
    const paths = new Set<string>();

    for (const output of toolOutputs) {
        const result = output.result;
        if (!result || typeof result !== 'object') {
            continue;
        }

        for (const key of ['path', 'filePath']) {
            const value = (result as any)[key];
            if (typeof value === 'string' && value.trim()) {
                paths.add(value.trim());
            }
        }
    }

    return Array.from(paths);
}

function safeJson(value: any) {
    try {
        const serialized = JSON.stringify(value);
        return typeof serialized === 'string' ? serialized : String(value);
    } catch {
        return String(value);
    }
}

function truncateHandoff(text: string) {
    if (text.length <= MAX_HANDOFF_CHARS) {
        return text;
    }

    return `${text.slice(0, MAX_HANDOFF_CHARS)}\n\n[Handoff truncated: ${text.length - MAX_HANDOFF_CHARS} chars omitted]`;
}

function formatToolOutputs(toolOutputs: MemberToolOutput[]) {
    return toolOutputs.map((entry, index) => [
        `Tool ${index + 1}: ${entry.toolName}`,
        `Args: ${safeJson(entry.args)}`,
        `Result: ${safeJson(entry.result)}`,
    ].join('\n')).join('\n\n');
}

function buildStageHandoff(member: LiveCandidate, response: string, toolOutputs: MemberToolOutput[]) {
    const blocks: string[] = [];

    if (response.trim()) {
        blocks.push(`MEMBER RESPONSE FROM ${member.name} (${member.id}):\n${response.trim()}`);
    }

    if (toolOutputs.length > 0) {
        blocks.push(`RAW TOOL OUTPUTS FROM ${member.name} (${member.id}):\n${formatToolOutputs(toolOutputs)}`);
    }

    return truncateHandoff(blocks.join('\n\n').trim());
}

async function getCrew(crewId: string) {
    const res = await query(
        `SELECT id, name, description, system_prompt, member_live_ids, orchestration_mode, llm_config_id, model_name
         FROM crews
         WHERE id = $1`,
        [crewId]
    );
    if (!res.rows.length) {
        throw new Error(`Crew not found: ${crewId}`);
    }
    return res.rows[0] as CrewRecord;
}

async function getCrewHistory(crewId: string, sessionKey: string) {
    const res = await query(
        `SELECT role, content
         FROM crew_chat_history
         WHERE crew_id = $1
           AND session_key = $2
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [crewId, sessionKey, CREW_MEMORY_MESSAGE_LIMIT]
    );

    return res.rows.reverse() as Array<{ role: string; content: string }>;
}

function buildCrewContextualUserMessage(history: Array<{ role: string; content: string }>, userMessage: string) {
    if (!history.length) {
        return userMessage;
    }

    const conversation = history.map((entry) => {
        const label = entry.role === 'assistant' ? 'Crew' : 'User';
        return `${label}: ${entry.content}`;
    }).join('\n\n');

    return [
        'Recent crew conversation context for this session:',
        conversation,
        '',
        'Current user request:',
        userMessage,
    ].join('\n');
}

async function persistCrewHistory(crewId: string, sessionKey: string, userMessage: string, assistantText: string) {
    await Promise.all([
        query(
            'INSERT INTO crew_chat_history (crew_id, session_key, role, content) VALUES ($1, $2, $3, $4)',
            [crewId, sessionKey, 'user', userMessage]
        ),
        query(
            'INSERT INTO crew_chat_history (crew_id, session_key, role, content) VALUES ($1, $2, $3, $4)',
            [crewId, sessionKey, 'assistant', assistantText]
        ),
    ]);

    await query(
        `DELETE FROM crew_chat_history
         WHERE crew_id = $1
           AND session_key = $2
           AND id IN (
               SELECT id
               FROM crew_chat_history
               WHERE crew_id = $1
                 AND session_key = $2
               ORDER BY created_at DESC, id DESC
               OFFSET $3
           )`,
        [crewId, sessionKey, CREW_MEMORY_MESSAGE_LIMIT]
    );
}

async function clearCrewHistory(crewId: string, sessionKey: string) {
    await query(
        'DELETE FROM crew_chat_history WHERE crew_id = $1 AND session_key = $2',
        [crewId, sessionKey]
    );
}

function isCrewMemoryClearRequest(userMessage: string) {
    const normalized = userMessage.toLowerCase();
    const asksClear = /(azzera|resetta|cancella|pulisci|dimentica|clear|reset)/.test(normalized);
    const mentionsMemory = /(memoria|contesto|sessione|history|storico|conversation)/.test(normalized);
    return asksClear && mentionsMemory;
}

async function getCrewMembers(memberLiveIds: string[]) {
    if (!Array.isArray(memberLiveIds) || memberLiveIds.length === 0) {
        return [];
    }

    const res = await query(
        `SELECT id, name, description, system_prompt, skills, routing_default
         FROM lives
         WHERE id = ANY($1::text[])`,
        [memberLiveIds]
    );

    const byId = new Map((res.rows as LiveCandidate[]).map((row) => [row.id, row]));
    return memberLiveIds
        .map((id) => byId.get(id))
        .filter((live): live is LiveCandidate => Boolean(live));
}

async function getOpenAIClient(config?: { apiKey?: string; baseURL?: string }) {
    if (config?.apiKey) {
        return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    }

    const res = await query("SELECT ciphertext FROM secrets WHERE key='openai.api_key'");
    if (!res.rows.length) {
        throw new Error('OpenAI API key not configured for crew supervisor');
    }
    const apiKey = JSON.parse(decrypt(res.rows[0].ciphertext as string));
    return new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL });
}

async function resolveCrewModelConfig(crew: CrewRecord) {
    let apiKey = process.env.OPENAI_API_KEY;
    let baseURL = process.env.OPENAI_BASE_URL;
    let modelName = crew.model_name || 'gpt-5-mini';

    if (crew.llm_config_id) {
        const configRes = await query(
            'SELECT provider, base_url, api_key_cipher FROM llm_configs WHERE id = $1',
            [crew.llm_config_id]
        );
        if (configRes.rows.length > 0) {
            const config = configRes.rows[0];
            baseURL = config.base_url || baseURL;

            if (config.provider === 'google' && !config.base_url) {
                baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            }

            if (config.provider === 'google' && !modelName.startsWith('models/')) {
                modelName = `models/${modelName}`;
            }

            if (config.api_key_cipher) {
                apiKey = JSON.parse(decrypt(config.api_key_cipher as string));
            }
        }
    }

    return {
        client: await getOpenAIClient({ apiKey, baseURL }),
        modelName,
    };
}

function buildAttemptOrder(members: LiveCandidate[], userMessage: string) {
    const selected = selectBestLiveCandidate(members, userMessage);
    const ranked = rankLiveCandidates(members, userMessage).map((entry) => entry.live);

    if (!selected) {
        return {
            cleanedMessage: userMessage.trim(),
            members: ranked.slice(0, MAX_MEMBER_ATTEMPTS),
            reason: 'channel_default' as const,
        };
    }

    return {
        cleanedMessage: selected.cleanedMessage,
        members: [
            selected.live,
            ...ranked.filter((live) => live.id !== selected.live.id),
        ].slice(0, MAX_MEMBER_ATTEMPTS),
        reason: selected.reason,
    };
}

async function runMember(
    member: LiveCandidate,
    message: string,
    opts: RunCrewOptions,
    stageLabel: string,
    streamToUser = false,
    crewRunId = ''
): Promise<MemberRunResult> {
    const memberSessionKey = `${opts.sessionKey}:run-${crewRunId}:${member.id}:${stageLabel}`;
    let bufferedDelta = '';
    const toolOutputs: MemberToolOutput[] = [];

    const response = await runLive({
        liveId: member.id,
        sessionKey: memberSessionKey,
        userMessage: message,
        channelContext: opts.channelContext,
        onDelta: (delta) => { bufferedDelta += delta; },
        onDone: undefined,
        onError: undefined,
        onToolResult: (toolEvent) => {
            toolOutputs.push(toolEvent);
        },
    });

    if (streamToUser && bufferedDelta) {
        opts.onDelta?.(bufferedDelta);
    }

    return {
        response,
        toolOutputs,
    };
}

async function runRouterOnly(crew: CrewRecord, members: LiveCandidate[], opts: RunCrewOptions, crewRunId: string) {
    const attemptPlan = buildAttemptOrder(members, opts.userMessage);
    let lastError: Error | null = null;

    logger.info(
        `Crew ${crew.id} selected ${attemptPlan.members.map((member) => member.id).join(', ')} (reason: ${attemptPlan.reason})`
    );

    for (const member of attemptPlan.members) {
        try {
            const memberResult = await runMember(member, attemptPlan.cleanedMessage, opts, 'router_only', true, crewRunId);
            const response = memberResult.response;
            if (response.trim().length > 0) {
                opts.onDone?.(response);
                return response;
            }

            lastError = new Error(`Crew member ${member.id} returned an empty response`);
            logger.warn(lastError.message);
        } catch (err: any) {
            lastError = err instanceof Error ? err : new Error(String(err));
            logger.warn(`Crew member ${member.id} failed: ${lastError.message}`);
        }
    }

    throw lastError ?? new Error(`Crew ${opts.crewId} could not complete the task`);
}

async function runPipeline(crew: CrewRecord, members: LiveCandidate[], opts: RunCrewOptions, crewRunId: string) {
    logger.info(`Crew ${crew.id} running in pipeline mode: ${members.map((member) => member.id).join(' -> ')}`);

    let previousOutput = '';
    let finalOutput = '';
    const stageKinds = buildPipelineStageKinds(members.length, opts.userMessage);
    let artifactPaths: string[] = [];

    for (let index = 0; index < members.length; index++) {
        const member = members[index];
        const isLast = index === members.length - 1;
        const stageKind = stageKinds[index] || 'other';
        const stageMessage = index === 0
            ? [
                'You are the first stage of a crew pipeline.',
                `Suggested stage focus: ${stageKind}.`,
                'Your job is to execute only your own stage and produce a rich textual handoff for the next member.',
                'Do not assume later stages will infer missing details.',
                stageKind === 'research'
                    ? 'You must actively gather source material and include concrete findings, extracted facts, URLs, titles, and raw text snippets in your handoff.'
                    : 'Produce output that is directly usable by the next member.',
                stageKind === 'draft'
                    ? 'Prefer to produce substantial written content, not just a status note.'
                    : '',
                stageKind === 'delivery'
                    ? 'If you create or send a file, prefer to use the exact content already present in the handoff.'
                    : '',
                'The stage focus is advisory, not a hard limit. Use the tools and actions you actually need to complete the task well.',
                '',
                `Original user request: ${opts.userMessage}`,
            ].join('\n')
            : [
                `You are stage ${index + 1} of a crew pipeline.`,
                `Suggested stage focus: ${stageKind}.`,
                'Previous stages are already completed.',
                'Avoid redoing earlier steps unless it is necessary to complete the task correctly.',
                'Use the handoff below as your primary context for what has already been done.',
                'Treat the previous crew output as canonical source material.',
                stageKind === 'research'
                    ? 'Do not claim that raw content is missing if it is present in the handoff. Extract and continue from the provided raw tool outputs.'
                    : '',
                stageKind === 'draft'
                    ? 'Prefer to produce the full body content, not just a status note.'
                    : '',
                stageKind === 'delivery'
                    ? 'Prefer to preserve the full content from the handoff and avoid replacing it with placeholders or templates.'
                    : '',
                'The stage focus is advisory, not a hard limit. If the task requires crossing categories, do it.',
                '',
                `Original user request (reference only): ${opts.userMessage}`,
                '',
                'Canonical handoff from previous stage:',
                previousOutput,
                artifactPaths.length > 0 ? `Concrete artifact paths from previous stages:\n${artifactPaths.join('\n')}` : '',
                '',
                `Act now as the next crew member (${member.name}) and complete the task using the handoff above.`,
            ].join('\n');

        const memberResult = await runMember(member, stageMessage, opts, `pipeline_${index + 1}`, isLast, crewRunId);
        const response = memberResult.response;
        if (!response.trim()) {
            throw new Error(`Pipeline member ${member.id} returned an empty response`);
        }

        const currentArtifactPaths = collectArtifactPaths(memberResult.toolOutputs);
        if (currentArtifactPaths.length > 0) {
            artifactPaths = currentArtifactPaths;
        }
        previousOutput = buildStageHandoff(member, response, memberResult.toolOutputs);
        finalOutput = response;
    }

    opts.onDone?.(finalOutput);
    return finalOutput;
}

function extractJsonObject(raw: string) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        return fenced[1].trim();
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
        return trimmed.slice(first, last + 1);
    }

    throw new Error('Supervisor did not return valid JSON');
}

async function buildSupervisorPlan(crew: CrewRecord, members: LiveCandidate[], userMessage: string): Promise<{ steps: NormalizedSupervisorStep[] }> {
    const { client, modelName } = await resolveCrewModelConfig(crew);
    const memberList = members.map((member) => ({
        liveId: member.id,
        name: member.name,
        description: member.description,
        skills: member.skills || [],
    }));

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [
            {
                role: 'system',
                content: [
                    'You are a crew supervisor.',
                    'Return ONLY JSON.',
                    'Choose the best sequence of agents to complete the user request.',
                    `Use at most ${MAX_SUPERVISOR_STEPS} steps.`,
                    'Schema: {"steps":[{"liveId":"agent_id","task":"specific task for that agent","kind":"research|draft|delivery|other"}]}',
                    'Only use liveId values from the provided member list.',
                    'Prefer one step for simple requests, multiple steps for research -> synthesis workflows.',
                    'Use "research" for gathering sources, "draft" for writing/synthesis, "delivery" for side effects like saving/uploading/emailing.',
                    'Avoid repeating the same agent in consecutive steps unless the second step is a different kind.',
                    crew.system_prompt ? `Crew instructions: ${crew.system_prompt}` : ''
                ].filter(Boolean).join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    userRequest: userMessage,
                    crew: {
                        id: crew.id,
                        name: crew.name,
                        description: crew.description,
                    },
                    members: memberList,
                })
            }
        ]
    });

    const raw = completion.choices[0]?.message?.content || '';
    const parsed = JSON.parse(extractJsonObject(raw)) as SupervisorPlan;

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        throw new Error('Supervisor returned no steps');
    }

    const allowedIds = new Set(members.map((member) => member.id));
    const normalizedSteps = parsed.steps
        .filter((step) => step && typeof step.liveId === 'string' && typeof step.task === 'string')
        .filter((step) => allowedIds.has(step.liveId))
        .slice(0, MAX_SUPERVISOR_STEPS)
        .map((step) => ({
            liveId: step.liveId,
            task: step.task.trim() || userMessage,
            kind: step.kind && ['research', 'draft', 'delivery', 'other'].includes(step.kind)
                ? step.kind
                : inferStepKind(step.task),
        }));

    if (normalizedSteps.length === 0) {
        throw new Error('Supervisor selected no valid crew members');
    }

    return { steps: compactSupervisorSteps(normalizedSteps) };
}

async function runSupervisor(crew: CrewRecord, members: LiveCandidate[], opts: RunCrewOptions, crewRunId: string) {
    let plan: { steps: NormalizedSupervisorStep[] };
    try {
        plan = await buildSupervisorPlan(crew, members, opts.userMessage);
    } catch (err: any) {
        logger.warn(`Crew supervisor planning failed for ${crew.id}: ${err.message}. Falling back to router_only.`);
        return runRouterOnly(crew, members, opts, crewRunId);
    }

    logger.info(`Crew ${crew.id} supervisor plan: ${plan.steps.map((step) => `${step.liveId}[${step.kind}]`).join(' -> ')}`);

    const memberMap = new Map(members.map((member) => [member.id, member]));
    const researchNotes: string[] = [];
    let latestDraft = '';
    let finalOutput = '';
    let artifactPaths: string[] = [];

    for (let index = 0; index < plan.steps.length; index++) {
        const step = plan.steps[index];
        const member = memberMap.get(step.liveId);
        if (!member) {
            continue;
        }

        const isLast = index === plan.steps.length - 1;
        const handoffBlocks = [
            `You are executing supervisor step ${index + 1} of ${plan.steps.length}.`,
            `Suggested step focus: ${step.kind}`,
            `Assigned crew task: ${step.task}`,
        ];

        if (researchNotes.length > 0) {
            handoffBlocks.push(`Structured research handoff:\n${researchNotes.join('\n\n')}`);
        }

        if (latestDraft) {
            handoffBlocks.push(`Latest draft/content handoff:\n${latestDraft}`);
        }

        if (artifactPaths.length > 0) {
            handoffBlocks.push(`Concrete artifact paths created by previous steps:\n${artifactPaths.join('\n')}`);
        }

        handoffBlocks.push(`Original user request (reference only): ${opts.userMessage}`);

        if (step.kind === 'draft') {
            handoffBlocks.push('You must use the research handoff above as your primary source material.');
            handoffBlocks.push('Prefer to produce the full content draft in plain text or markdown.');
            handoffBlocks.push(`The draft must be substantial and content-rich (minimum target ${MIN_DRAFT_CONTENT_CHARS} characters).`);
            handoffBlocks.push('Do not answer with status updates, blockers, or procedural commentary unless the handoff is truly missing.');
        }

        if (step.kind === 'delivery') {
            handoffBlocks.push('Treat the latest draft as the canonical content to save/upload/send.');
            handoffBlocks.push('Prefer not to replace it with placeholders, summaries, or an empty template.');
            handoffBlocks.push('If you create a document, the body should contain the full draft content provided above.');
            handoffBlocks.push('Do not claim missing context if a research handoff or draft handoff is present above, unless it is genuinely insufficient.');
        }

        handoffBlocks.push('The suggested step focus is advisory, not a hard constraint. Use the capabilities you need to complete the task.');

        const taskMessage = handoffBlocks.join('\n\n');

        const memberResult = await runMember(member, taskMessage, opts, `supervisor_${index + 1}`, isLast, crewRunId);
        const response = memberResult.response;
        if (!response.trim()) {
            throw new Error(`Supervisor step ${index + 1} (${member.id}) returned an empty response`);
        }

        const currentArtifactPaths = collectArtifactPaths(memberResult.toolOutputs);
        if (currentArtifactPaths.length > 0) {
            artifactPaths = currentArtifactPaths;
        }

        if (step.kind === 'research') {
            researchNotes.push(buildStageHandoff(member, response, memberResult.toolOutputs));
        } else if (step.kind === 'draft') {
            if (response.trim().length < MIN_DRAFT_CONTENT_CHARS || looksOperationalOnly(response)) {
                logger.warn(`Supervisor step ${index + 1} (${member.id}) returned thin draft content (${response.trim().length} chars)`);
            }
            latestDraft = response;
        } else if (step.kind === 'other') {
            latestDraft = response;
        }

        finalOutput = response;
    }

    opts.onDone?.(finalOutput);
    return finalOutput;
}

export async function runCrew(opts: RunCrewOptions): Promise<string> {
    try {
        const crew = await getCrew(opts.crewId);
        const members = await getCrewMembers(crew.member_live_ids || []);
        const baseUserMessage = opts.userMessage;

        if (isCrewMemoryClearRequest(baseUserMessage)) {
            await clearCrewHistory(opts.crewId, opts.sessionKey)
                .catch((e: any) => logger.warn(`Failed to clear crew history for ${opts.crewId}: ${e.message}`));
            const clearedMessage = 'Memoria conversazionale della crew azzerata per la sessione corrente.';
            opts.onDone?.(clearedMessage);
            return clearedMessage;
        }

        const history = await getCrewHistory(opts.crewId, opts.sessionKey).catch(() => []);
        const contextualOpts: RunCrewOptions = {
            ...opts,
            userMessage: buildCrewContextualUserMessage(history, baseUserMessage),
        };

        if (members.length === 0) {
            throw new Error(`Crew ${opts.crewId} has no valid members`);
        }

        const crewRunId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

        let response = '';
        switch (crew.orchestration_mode || 'router_only') {
            case 'pipeline':
                response = await runPipeline(crew, members, contextualOpts, crewRunId);
                break;
            case 'supervisor_llm':
                response = await runSupervisor(crew, members, contextualOpts, crewRunId);
                break;
            case 'router_only':
            default:
                response = await runRouterOnly(crew, members, contextualOpts, crewRunId);
                break;
        }

        await persistCrewHistory(opts.crewId, opts.sessionKey, baseUserMessage, response)
            .catch((e: any) => logger.warn(`Failed to persist crew history for ${opts.crewId}: ${e.message}`));

        return response;
    } catch (err: any) {
        const finalError = err instanceof Error ? err : new Error(String(err));
        opts.onError?.(finalError);
        throw finalError;
    }
}
