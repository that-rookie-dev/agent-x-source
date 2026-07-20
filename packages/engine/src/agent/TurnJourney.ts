/**
 * TurnJourney — default research pipeline for every non-trivial turn.
 *
 * Users should not need to say "check RAG", "use MCP", or "search the web".
 * The journey prefetches cheap local knowledge, then injects a strict stage
 * order the model follows automatically. Explicit user how-to still wins.
 */

import { getLogger } from '@agentx/shared';
import { getRAGEngineInstance } from '../commands/builtin/rag_index.js';
import { getKnowledgeBaseService } from '../knowledge-base/global-manager.js';

const logger = getLogger();

const TURN_JOURNEY_PREFETCH_TIMEOUT_MS = 5_000;

async function withPrefetchTimeout<T>(label: string, work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out`)), TURN_JOURNEY_PREFETCH_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    logger.warn('TURN_JOURNEY_TIMEOUT', e instanceof Error ? e.message : String(e));
    return fallback;
  }
}

export type TurnJourneyStageId =
  | 'local_knowledge'
  | 'deeper_retrieval'
  | 'integrations'
  | 'web'
  | 'model';

export interface TurnJourneyStageReport {
  id: TurnJourneyStageId;
  status: 'done' | 'ready' | 'skipped';
  detail: string;
  elapsedMs?: number;
}

export interface TurnJourneyRagHit {
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface TurnJourneyInput {
  userText: string;
  /** Fast-reply / greeting path — no journey. */
  skip?: boolean;
  /** Local / compact models — lighter brief, skip heavy prefetch. */
  compact?: boolean;
  voiceTurn?: boolean;
  /** Active tool ids for this agent (after registry load). */
  availableToolIds: string[];
}

export interface TurnJourneyResult {
  ragResults: TurnJourneyRagHit[];
  journeyBlock: string;
  stages: TurnJourneyStageReport[];
  elapsedMs: number;
}

const WEB_TOOLS = new Set(['web_search', 'deep_web_search', 'web_fetch', 'web_scrape']);
const MEMORY_TOOLS = new Set([
  'knowledge_base_search',
  'cortex_memory_search',
  'memory_recall',
  'codebase_search',
]);

function summarizeIntegrations(toolIds: string[]): string[] {
  const names = new Set<string>();
  for (const id of toolIds) {
    if (!id.startsWith('integration__')) continue;
    // integration__gmail__list_messages → gmail
    const rest = id.slice('integration__'.length);
    const server = rest.split('__')[0] || rest.split('_')[0] || rest;
    if (server) names.add(server);
  }
  return [...names].sort().slice(0, 12);
}

function listPresent(toolIds: string[], candidates: string[]): string[] {
  return candidates.filter((id) => toolIds.includes(id));
}

async function prefetchLocalKnowledge(userText: string): Promise<{
  hits: TurnJourneyRagHit[];
  stages: TurnJourneyStageReport[];
}> {
  const stages: TurnJourneyStageReport[] = [];
  const hits: TurnJourneyRagHit[] = [];

  const kbStart = Date.now();
  const kb = getKnowledgeBaseService();
  if (kb) {
    try {
      const kbResults = await withPrefetchTimeout(
        'Knowledge Base search',
        kb.search(userText, 8),
        [],
      );
      for (const r of kbResults) {
        hits.push({
          content: r.content,
          score: r.score,
          metadata: {
            ...(r.metadata ?? {}),
            source: r.sourceName || r.sourceId,
            sourceName: r.sourceName || r.sourceId,
            kind: r.kind,
            pageNumber: r.metadata?.pageNumber,
          },
        });
      }
      stages.push({
        id: 'local_knowledge',
        status: 'done',
        detail: `Knowledge Base: ${kbResults.length} hit(s)`,
        elapsedMs: Date.now() - kbStart,
      });
    } catch (e) {
      logger.warn('TURN_JOURNEY_KB', e instanceof Error ? e.message : String(e));
      stages.push({
        id: 'local_knowledge',
        status: 'skipped',
        detail: 'Knowledge Base search failed',
        elapsedMs: Date.now() - kbStart,
      });
    }
  } else {
    stages.push({
      id: 'local_knowledge',
      status: 'skipped',
      detail: 'Knowledge Base unavailable',
    });
  }

  const ragStart = Date.now();
  const rag = getRAGEngineInstance();
  if (rag?.isEnabled) {
    try {
      const docs = await withPrefetchTimeout('Codebase RAG search', rag.search(userText, 3), []);
      for (const d of docs) {
        hits.push({
          content: d.content,
          score: d.score,
          metadata: { ...(d.metadata ?? {}), kind: 'codebase' },
        });
      }
      stages.push({
        id: 'local_knowledge',
        status: 'done',
        detail: `Codebase RAG: ${docs.length} hit(s)`,
        elapsedMs: Date.now() - ragStart,
      });
    } catch (e) {
      logger.warn('TURN_JOURNEY_RAG', e instanceof Error ? e.message : String(e));
    }
  }

  // Prefer KB hits first; cap total injected context.
  const kbFirst = [
    ...hits.filter((h) => h.metadata?.kind !== 'codebase'),
    ...hits.filter((h) => h.metadata?.kind === 'codebase'),
  ].slice(0, 8);

  return { hits: kbFirst, stages };
}

function buildJourneyBlock(opts: {
  voiceTurn: boolean;
  compact: boolean;
  localHitCount: number;
  toolIds: string[];
  stages: TurnJourneyStageReport[];
}): string {
  const integrations = summarizeIntegrations(opts.toolIds);
  const webTools = listPresent(opts.toolIds, [...WEB_TOOLS]);
  const memoryTools = listPresent(opts.toolIds, [...MEMORY_TOOLS]);
  const hasKnowledgeSearch = opts.toolIds.includes('knowledge_base_search');

  if (opts.voiceTurn || opts.compact) {
    const integLine =
      integrations.length > 0
        ? `MCP ready: ${integrations.join(', ')}.`
        : 'No MCP integrations connected.';
    return [
      '[TURN_JOURNEY]',
      'Default silent research order (user did not need to request tools):',
      `1. LOCAL — ${opts.localHitCount > 0 ? `${opts.localHitCount} excerpt(s) injected above` : 'none yet'}; if weak, call knowledge_base_search.`,
      `2. INTEGRATIONS — ${integLine} Use matching integration__* tools when the ask involves those apps.`,
      `3. WEB — ${webTools.length > 0 ? webTools.join(', ') : 'unavailable'} only if local+MCP cannot answer or facts may be stale.`,
      '4. MODEL — brief answer from trained knowledge last; say when unsure.',
      'Do not narrate this pipeline. Explicit user how-to overrides. Keep voice replies short.',
      '[/TURN_JOURNEY]',
    ].join('\n');
  }

  const stageLines = opts.stages.map((s) => `- ${s.id}: ${s.status}${s.detail ? ` (${s.detail})` : ''}`);

  return [
    '[TURN_JOURNEY]',
    'Default research pipeline for this turn. The user is having a conversation — they should NOT need to tell you to "check RAG", "use MCP", or "search the web". Follow this order automatically. Explicit user how-to ("use web only", "skip search", "use Gmail") overrides.',
    '',
    'STAGE 1 — LOCAL KNOWLEDGE (prefetch)',
    opts.localHitCount > 0
      ? `- Done: ${opts.localHitCount} excerpt(s) are injected as [RELEVANT_DOCUMENTS]. Prefer body text over TOC/index lines. Cite source/page when answering from them.`
      : '- Prefetch found nothing useful yet (or KB empty). Proceed to stage 2.',
    '- If excerpts answer the question fully → answer now and stop. Do not invent extra tool calls.',
    '',
    'STAGE 2 — DEEPER LOCAL RETRIEVAL (tools, only if needed)',
    hasKnowledgeSearch
      ? '- Call knowledge_base_search with a more precise query when excerpts look like indexes/metadata or miss the answer.'
      : '- knowledge_base_search unavailable.',
    memoryTools.length > 0
      ? `- Also available: ${memoryTools.join(', ')} for prior chat/memory facts.`
      : '- No extra memory tools in this turn.',
    '',
    'STAGE 3 — CONNECTED INTEGRATIONS (MCP)',
    integrations.length > 0
      ? `- Connected servers: ${integrations.join(', ')}. If the question involves these apps/accounts, use the matching integration__* tools next.`
      : '- No MCP integrations connected this turn. If the user needs a live app/account, tell them to connect it in Settings → MCP Store — do not scavenge credentials from disk/shell.',
    '- Never use shell/filesystem hunting for third-party credentials (see [THIRD_PARTY_SERVICES]).',
    '',
    'STAGE 4 — INTERNET',
    webTools.length > 0
      ? `- Tools: ${webTools.join(', ')}. Use when local+MCP are insufficient, or for current/public facts, news, docs, or verification.`
      : '- Web tools unavailable this turn.',
    '- Skip web if stage 1–3 already answered completely.',
    '',
    'STAGE 5 — MODEL KNOWLEDGE',
    '- Use trained knowledge only after the above. Be honest when uncertain or when sources conflict.',
    '',
    'STYLE:',
    '- Do not narrate the pipeline ("First I will search RAG…"). Just gather what you need, then answer.',
    '- How-to still works: if the user names a tool/path, prefer it.',
    '',
    'Prefetch status:',
    ...stageLines,
    '[/TURN_JOURNEY]',
  ].join('\n');
}

/**
 * Run the default turn journey: prefetch local knowledge + build stage brief.
 */
export async function runTurnJourney(input: TurnJourneyInput): Promise<TurnJourneyResult> {
  const started = Date.now();
  if (input.skip) {
    return {
      ragResults: [],
      journeyBlock: '',
      stages: [{ id: 'local_knowledge', status: 'skipped', detail: 'Fast path — journey skipped' }],
      elapsedMs: 0,
    };
  }

  const stages: TurnJourneyStageReport[] = [];
  // Always prefetch local knowledge on the standard path (chat + voice), even for
  // compact models — users should not need to ask for RAG. Cap size in PromptEngine.
  const local = await prefetchLocalKnowledge(input.userText);
  const ragResults = local.hits;
  stages.push(...local.stages);

  const toolIds = input.availableToolIds;
  stages.push({
    id: 'deeper_retrieval',
    status: 'ready',
    detail: toolIds.includes('knowledge_base_search')
      ? 'knowledge_base_search available'
      : 'limited retrieval tools',
  });
  stages.push({
    id: 'integrations',
    status: summarizeIntegrations(toolIds).length > 0 ? 'ready' : 'skipped',
    detail:
      summarizeIntegrations(toolIds).length > 0
        ? `MCP: ${summarizeIntegrations(toolIds).join(', ')}`
        : 'No MCP integrations',
  });
  stages.push({
    id: 'web',
    status: listPresent(toolIds, [...WEB_TOOLS]).length > 0 ? 'ready' : 'skipped',
    detail: listPresent(toolIds, [...WEB_TOOLS]).join(', ') || 'No web tools',
  });
  stages.push({
    id: 'model',
    status: 'ready',
    detail: 'Trained knowledge fallback',
  });

  const journeyBlock = buildJourneyBlock({
    voiceTurn: input.voiceTurn === true,
    compact: input.compact === true,
    localHitCount: ragResults.length,
    toolIds,
    stages,
  });

  return {
    ragResults,
    journeyBlock,
    stages,
    elapsedMs: Date.now() - started,
  };
}
