import type { Request, Response } from 'express';
import { getEngine, getOrCreateAgent, awaitEngineStorageReady } from './engine.js';
import {
  getCrewSuggestionService,
  recruitCandidatesForMission,
  catalogEntryToSummary,
  getCatalogSeedStatus,
  healDatabaseStore,
  ProviderFactory,
  createCrewKeywordExpander,
  type CrewCatalogStore,
  type CrewKeywordExpandFn,
} from '@agentx/engine';
import type { CrewMatchCandidate, CrewSuggestionEvaluation, CatalogEntry } from '@agentx/shared';
import { explicitCrewRequest } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { mapPrimaryCrewId } from './crew-roster-picker-api.js';

function getStore(eng: ReturnType<typeof getEngine>): unknown {
  return (eng.sessionManager as unknown as { store?: unknown }).store;
}

async function ensureCatalogOperational(eng: ReturnType<typeof getEngine>): Promise<void> {
  await awaitEngineStorageReady();
  await healDatabaseStore(getStore(eng));
}

function hasAtMention(text: string): boolean {
  return /(?<!\w)@([\w][\w.-]*)/.test(text);
}

function getCatalogStore(eng: ReturnType<typeof getEngine>) {
  const store = getStore(eng);
  return (store as { getCrewCatalogStore?: () => {
    listCategories: () => Promise<unknown>;
    listByCategory: (categoryId: string, limit: number) => Promise<unknown>;
    searchCatalog: (query: string, limit: number) => Promise<Array<CatalogEntry & { ftsRank: number }>>;
  } }).getCrewCatalogStore?.() ?? null;
}

export function emitCrewSuggestionTelemetry(
  eng: ReturnType<typeof getEngine>,
  evaluation: CrewSuggestionEvaluation,
  message?: string,
): void {
  if (!evaluation.shouldSuggest) return;
  try {
    eng.telemetry.emit({
      type: 'crew_suggestion',
      evaluation,
      message,
    } as never);
  } catch { /* best-effort */ }
}

function resolveKeywordExpander(eng: ReturnType<typeof getEngine>): CrewKeywordExpandFn | undefined {
  if (!eng.configured) return undefined;
  try {
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers[providerId];
    if (!providerCfg?.configured) return undefined;
    const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
    return createCrewKeywordExpander({
      provider,
      model: cfg.provider.activeModel,
      requireExpertisePattern: false,
    });
  } catch {
    return undefined;
  }
}

export async function evaluateCrewSuggestionForMessage(input: {
  text: string;
  sessionId: string;
  priorUserMessages?: string[];
}): Promise<CrewSuggestionEvaluation | null> {
  const eng = getEngine();
  await ensureCatalogOperational(eng);
  const service = getCrewSuggestionService(getStore(eng));
  if (!service) return null;
  const prior = input.priorUserMessages ?? getPriorUserMessagesFromStore(eng, input.sessionId);
  return service.evaluate({
    message: input.text,
    sessionId: input.sessionId,
    priorUserMessages: prior,
    hasAtMention: hasAtMention(input.text),
    explicitCrewRequest: explicitCrewRequest(input.text),
    expandKeywords: resolveKeywordExpander(eng),
  });
}

export function getPriorUserMessagesFromStore(
  eng: ReturnType<typeof getEngine>,
  sessionId: string,
  limit = 3,
): string[] {
  try {
    const store = getStore(eng) as {
      getMessages?: (sid: string) => Array<{ role?: string; content?: string }>;
    } | undefined;
    if (!store?.getMessages) return [];
    return store
      .getMessages(sessionId)
      .filter((m) => m.role === 'user' && typeof m.content === 'string')
      .map((m) => m.content as string)
      .slice(-limit);
  } catch {
    return [];
  }
}

export type CrewSuggestionBlockResult =
  | { block: true; evaluation: CrewSuggestionEvaluation; message: string }
  | { block: false };

/** Server-side gate: block agent turn until user resolves crew suggestion modal. */
export async function blockForCrewSuggestionIfNeeded(input: {
  text: string;
  sessionId: string;
  priorUserMessages?: string[];
  crewPrivateChat: boolean;
  delegateCrewIds?: string[];
  crewSuggestionResolved?: boolean;
}): Promise<CrewSuggestionBlockResult> {
  if (input.crewPrivateChat) return { block: false };
  if (input.delegateCrewIds?.length) return { block: false };
  if (input.crewSuggestionResolved) return { block: false };
  if (hasAtMention(input.text)) return { block: false };

  const evaluation = await evaluateCrewSuggestionForMessage({
    text: input.text,
    sessionId: input.sessionId,
    priorUserMessages: input.priorUserMessages,
  });

  if (!evaluation) {
    getLogger().warn('CREW_SUGGESTION', 'catalog-unavailable during chat gate');
    return { block: false };
  }

  if (evaluation.shouldSuggest && evaluation.candidates.length > 0) {
    return { block: true, evaluation, message: input.text };
  }
  return { block: false };
}

export async function postCrewSuggestionEvaluate(req: Request, res: Response): Promise<void> {
  try {
    const { text, sessionId, priorUserMessages } = req.body as {
      text: string;
      sessionId: string;
      priorUserMessages?: string[];
    };
    const eng = getEngine();
    const service = getCrewSuggestionService(getStore(eng));
    if (!service) {
      res.json({
        shouldSuggest: false,
        dismissed: false,
        confidence: 0,
        taskSummary: text,
        candidates: [],
        reasons: ['catalog-unavailable'],
      });
      return;
    }

    const evaluation = await service.evaluate({
      message: text,
      sessionId,
      priorUserMessages,
      hasAtMention: hasAtMention(text),
      explicitCrewRequest: explicitCrewRequest(text),
      expandKeywords: resolveKeywordExpander(eng),
    });

    emitCrewSuggestionTelemetry(eng, evaluation, text);
    res.json(evaluation);
  } catch (e: unknown) {
    getLogger().error('CREW_SUGGESTION_EVALUATE', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'evaluate-failed' });
  }
}

export async function postCrewSuggestionResolve(req: Request, res: Response): Promise<void> {
  try {
    const {
      sessionId,
      action,
      dismissForSession,
      selectedCandidateIds,
      candidates,
    } = req.body as {
      sessionId: string;
      action: 'deploy' | 'skip' | 'dismiss';
      dismissForSession?: boolean;
      selectedCandidateIds?: string[];
      candidates?: CrewMatchCandidate[];
    };

    const eng = getEngine();
    const store = getStore(eng);
    const service = getCrewSuggestionService(store);
    if (!service) {
      res.status(503).json({ error: 'catalog-unavailable' });
      return;
    }

    const prefs = await service.resolve({
      sessionId,
      action: action === 'dismiss' || dismissForSession ? 'dismiss' : action,
      dismissForSession,
    });

    let deployedCrewIds: string[] = [];
    let deployedPrimaryCrewId: string | undefined;
    if (action === 'deploy' && selectedCandidateIds?.length && candidates?.length) {
      const selected = candidates.filter((c) => selectedCandidateIds.includes(c.id));
      if (!eng.agent) getOrCreateAgent();
      const catalogStore = (store as { getCrewCatalogStore?: () => { getCatalogEntry: (id: string) => Promise<unknown> } }).getCrewCatalogStore?.();
      if (catalogStore) {
        deployedCrewIds = await recruitCandidatesForMission(
          eng.crewManager,
          eng.agent,
          selected,
          catalogStore as Parameters<typeof recruitCandidatesForMission>[3],
        );
        const topCandidateId = [...selected].sort((a, b) => b.matchScore - a.matchScore)[0]?.id;
        deployedPrimaryCrewId = mapPrimaryCrewId(topCandidateId, selected, deployedCrewIds);
      }
      eng.crewManager.refresh();
      if (deployedCrewIds.length === 0) {
        res.status(422).json({
          ok: false,
          error: 'crew-deploy-failed',
          message: 'Selected specialists could not be recruited or enabled.',
          preferences: prefs,
          deployedCrewIds: [],
        });
        return;
      }
    }

    res.json({ ok: true, preferences: prefs, deployedCrewIds, deployedPrimaryCrewId });
  } catch (e: unknown) {
    getLogger().error('CREW_SUGGESTION_RESOLVE', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'resolve-failed' });
  }
}

export async function postCrewSuggestionClearDismiss(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.body as { sessionId: string };
    const eng = getEngine();
    const service = getCrewSuggestionService(getStore(eng));
    if (!service) {
      res.status(503).json({ error: 'catalog-unavailable' });
      return;
    }
    const prefs = await service.clearDismiss(sessionId);
    res.json({ ok: true, preferences: prefs });
  } catch (e: unknown) {
    getLogger().error('CREW_SUGGESTION_CLEAR_DISMISS', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-dismiss-failed' });
  }
}

export async function getCatalogEntry(req: Request, res: Response): Promise<void> {
  try {
    const eng = getEngine();
    const service = getCrewSuggestionService(getStore(eng));
    if (!service) {
      res.status(503).json({ error: 'catalog-unavailable' });
      return;
    }
    const entry = await service.getCatalogEntry(req.params['id']!);
    if (!entry) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    res.json({ entry });
  } catch (e: unknown) {
    getLogger().error('CREW_CATALOG_GET', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'catalog-get-failed' });
  }
}

export async function getCatalogSeedStatusHandler(_req: Request, res: Response): Promise<void> {
  try {
    const eng = getEngine();
    await ensureCatalogOperational(eng);
    const catalogStore = getCatalogStore(eng);
    if (!catalogStore) {
      res.json({
        status: 'idle',
        table: 'crew_catalog',
        ftsTable: 'crew_catalog_fts',
        seededCount: 0,
        expectedCount: 0,
        manifestRevision: 0,
        storedRevision: 0,
        percent: 0,
        processedInRun: 0,
      });
      return;
    }
    const ftsTable = eng.pgPool ? 'crew_catalog.search_tsv' : 'crew_catalog_fts';
    const snapshot = await getCatalogSeedStatus(catalogStore as CrewCatalogStore, ftsTable);
    res.json(snapshot);
  } catch (e: unknown) {
    getLogger().error('CREW_CATALOG_SEED_STATUS', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'catalog-seed-status-failed' });
  }
}

export async function listCatalogCategories(_req: Request, res: Response): Promise<void> {
  try {
    const eng = getEngine();
    await ensureCatalogOperational(eng);
    const service = getCrewSuggestionService(getStore(eng));
    const catalogStore = getCatalogStore(eng);
    if (!service || !catalogStore) {
      res.status(503).json({ error: 'catalog-unavailable' });
      return;
    }
    await service.ensureReady();
    const categories = await catalogStore.listCategories();
    res.json({ categories });
  } catch (e: unknown) {
    getLogger().error('CREW_CATALOG_CATEGORIES', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'catalog-categories-failed' });
  }
}

export async function listCatalogByCategory(req: Request, res: Response): Promise<void> {
  try {
    const eng = getEngine();
    await ensureCatalogOperational(eng);
    const service = getCrewSuggestionService(getStore(eng));
    const catalogStore = getCatalogStore(eng);
    if (!service || !catalogStore) {
      res.status(503).json({ error: 'catalog-unavailable' });
      return;
    }
    await service.ensureReady();
    const categoryId = req.params['categoryId']!;
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '500'), 10) || 500, 1000);
    const crews = await catalogStore.listByCategory(categoryId, limit);
    res.json({ crews });
  } catch (e: unknown) {
    getLogger().error('CREW_CATALOG_BY_CATEGORY', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'catalog-list-failed' });
  }
}

export async function searchCatalogEntries(req: Request, res: Response): Promise<void> {
  try {
    const eng = getEngine();
    await ensureCatalogOperational(eng);
    const service = getCrewSuggestionService(getStore(eng));
    const catalogStore = getCatalogStore(eng);
    if (!service || !catalogStore) {
      res.status(503).json({ error: 'catalog-unavailable' });
      return;
    }
    await service.ensureReady();
    const q = String(req.query['q'] ?? '').trim();
    if (!q) {
      res.json({ crews: [] });
      return;
    }
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '40'), 10) || 40, 100);
    const hits = await catalogStore.searchCatalog(q, limit);
    res.json({ crews: hits.map((hit) => catalogEntryToSummary(hit)) });
  } catch (e: unknown) {
    getLogger().error('CREW_CATALOG_SEARCH', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'catalog-search-failed' });
  }
}
