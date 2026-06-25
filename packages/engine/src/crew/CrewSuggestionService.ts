import type {
  CatalogEntry,
  CatalogManifest,
  CatalogCategorySummary,
  CatalogSummary,
  Crew,
  CrewSuggestionEvaluation,
  SessionCrewPreferences,
} from '@agentx/shared';
import { crewRequiresMedicalDisclaimer, isWorkforceOrSpecialistNeed } from '@agentx/shared';
import type { RawMatchRow } from './CrewMatchService.js';
import {
  buildCrewSuggestionSearchQuery,
  isActiveCrewContinuation,
  isDistinctNewRequirement,
} from '../agent/crew-auto-compose.js';
import {
  evaluateSuggestionGate,
  scoreMatchCandidates,
  shouldShowSuggestion,
  taskSummaryFromMessage,
  CREW_MATCH_THRESHOLDS,
} from './CrewMatchService.js';
import { loadCatalogManifest } from './catalog-manifest.js';
import { syncCatalogFromManifest } from './catalog-sync.js';

/** Storage operations required for crew catalog + suggestions (SQLite + Postgres). */
export interface CrewCatalogStore {
  getCatalogRevision(): Promise<number>;
  getCatalogCount(): Promise<number>;
  seedCatalog(manifest: CatalogManifest): Promise<{ inserted: number; updated: number }>;
  ensureCatalogSeeded(): Promise<void>;
  searchCatalog(query: string, limit: number): Promise<Array<CatalogEntry & { ftsRank: number }>>;
  listCategories(): Promise<CatalogCategorySummary[]>;
  listByCategory(categoryId: string, limit: number): Promise<CatalogSummary[]>;
  searchRosterCrews(query: string, limit: number): Promise<Array<Crew & { ftsRank: number }>>;
  getCatalogEntry(id: string): Promise<CatalogEntry | null>;
  getCatalogByCallsign(callsign: string): Promise<CatalogEntry | null>;
  listRecruitedCatalogIds(): Promise<Set<string>>;
  getSessionCrewPreferences(sessionId: string): Promise<SessionCrewPreferences>;
  upsertSessionCrewPreferences(sessionId: string, patch: Partial<SessionCrewPreferences>): Promise<SessionCrewPreferences>;
  getSessionCrewMessageCounts(sessionId: string): Promise<Map<string, number>>;
  getSessionEnabledCrewIds(sessionId: string): Promise<string[]>;
}

export class CrewSuggestionService {
  constructor(private readonly store: CrewCatalogStore) {}

  async ensureReady(): Promise<void> {
    await syncCatalogFromManifest(this.store);
  }

  async evaluate(input: {
    message: string;
    sessionId: string;
    priorUserMessages?: string[];
    hasAtMention?: boolean;
    explicitCrewRequest?: boolean;
  }): Promise<CrewSuggestionEvaluation> {
    await this.ensureReady();

    let prefs = await this.store.getSessionCrewPreferences(input.sessionId);
    if (input.explicitCrewRequest && prefs.suggestionsDismissed) {
      prefs = await this.clearDismiss(input.sessionId);
    }
    const gate = evaluateSuggestionGate({
      message: input.message,
      priorUserMessages: input.priorUserMessages,
      dismissed: prefs.suggestionsDismissed,
      hasAtMention: input.hasAtMention ?? false,
      explicitCrewRequest: input.explicitCrewRequest ?? false,
    });

    const empty: CrewSuggestionEvaluation = {
      shouldSuggest: false,
      dismissed: prefs.suggestionsDismissed,
      confidence: 0,
      taskSummary: taskSummaryFromMessage(gate.task),
      candidates: [],
      reasons: gate.reasons,
    };

    if (!gate.pass) return empty;

    const recruited = await this.store.listRecruitedCatalogIds();
    const searchQuery = buildCrewSuggestionSearchQuery(gate.task);
    const catalogHits = await this.store.searchCatalog(searchQuery, 20);
    const rosterHits = await this.store.searchRosterCrews(searchQuery, 20);

    const rows: RawMatchRow[] = [];

    for (const hit of catalogHits) {
      if (recruited.has(hit.id)) continue;
      rows.push({
        id: hit.id,
        origin: 'hub_catalog',
        callsign: hit.callsign,
        name: hit.name,
        title: hit.title,
        categoryId: hit.categoryId,
        categoryLabel: hit.categoryLabel,
        description: hit.description,
        expertise: hit.expertise,
        traits: hit.traits,
        tone: hit.tone,
        catalogId: hit.id,
        onRoster: false,
        enabled: false,
        ftsRank: hit.ftsRank,
        systemPrompt: hit.systemPrompt,
        requiresMedicalDisclaimer: crewRequiresMedicalDisclaimer({
          categoryId: hit.categoryId,
          catalogId: hit.id,
        }),
      });
    }

    for (const crew of rosterHits) {
      const origin = crew.source === 'custom' ? 'custom' : 'hub_roster';
      rows.push({
        id: crew.id,
        origin,
        callsign: crew.callsign,
        name: crew.name,
        title: crew.title ?? '',
        description: crew.description ?? '',
        expertise: crew.expertise ?? [],
        traits: crew.traits ?? [],
        tone: crew.emotion,
        catalogId: crew.catalogId,
        onRoster: true,
        enabled: crew.enabled,
        ftsRank: crew.ftsRank,
        systemPrompt: crew.systemPrompt,
        requiresMedicalDisclaimer: crewRequiresMedicalDisclaimer({
          categoryId: undefined,
          catalogId: crew.catalogId ?? crew.id,
        }),
      });
    }

    const sessionCounts = await this.store.getSessionCrewMessageCounts(input.sessionId);
    const enabledCrewIds = await this.store.getSessionEnabledCrewIds(input.sessionId);
    const priorMessages = input.priorUserMessages ?? [];
    const candidates = scoreMatchCandidates(gate.task, rows, { sessionMessageCounts: sessionCounts });
    const rosterFirst = (input.explicitCrewRequest ?? false) || isWorkforceOrSpecialistNeed(input.message);

    if (enabledCrewIds.length > 0 && !rosterFirst) {
      const isContinuation = isActiveCrewContinuation(input.message, priorMessages);
      const isNewRequirement = isDistinctNewRequirement(input.message, priorMessages);

      if (isContinuation && !isNewRequirement) {
        return {
          ...empty,
          reasons: ['active-crew-continuation'],
        };
      }

      const filtered = candidates.filter((c) => !enabledCrewIds.includes(c.id));
      if (filtered.length === 0) {
        return {
          ...empty,
          reasons: ['no-new-specialists'],
        };
      }

      const threshold = rosterFirst
        ? CREW_MATCH_THRESHOLDS.minCandidateScore
        : isNewRequirement
          ? CREW_MATCH_THRESHOLDS.minSuggestConfidence
          : CREW_MATCH_THRESHOLDS.minSuggestWithActiveCrew;
      const shouldSuggest = shouldShowSuggestion(filtered, threshold);
      const confidence = filtered[0]?.matchScore ?? 0;

      return {
        shouldSuggest,
        dismissed: prefs.suggestionsDismissed,
        confidence,
        taskSummary: taskSummaryFromMessage(gate.task),
        candidates: filtered,
        reasons: shouldSuggest
          ? ['matched-specialists', isNewRequirement ? 'new-requirement' : 'elevated-threshold']
          : ['below-threshold-active-crew'],
      };
    }

    const suggestThreshold = rosterFirst
      ? CREW_MATCH_THRESHOLDS.minCandidateScore
      : CREW_MATCH_THRESHOLDS.minSuggestConfidence;
    const shouldSuggest = shouldShowSuggestion(candidates, suggestThreshold);
    const confidence = candidates[0]?.matchScore ?? 0;

    return {
      shouldSuggest,
      dismissed: prefs.suggestionsDismissed,
      confidence,
      taskSummary: taskSummaryFromMessage(gate.task),
      candidates,
      reasons: shouldSuggest
        ? ['matched-specialists', ...(rosterFirst ? ['workforce-intent'] : [])]
        : [rosterFirst ? 'below-threshold-workforce' : 'below-threshold'],
    };
  }

  async resolve(input: {
    sessionId: string;
    action: 'deploy' | 'skip' | 'dismiss';
    dismissForSession?: boolean;
  }): Promise<SessionCrewPreferences> {
    const now = new Date().toISOString();
    if (input.action === 'dismiss' || input.dismissForSession) {
      return this.store.upsertSessionCrewPreferences(input.sessionId, {
        suggestionsDismissed: true,
        dismissedAt: now,
        updatedAt: now,
      });
    }
    if (input.action === 'deploy') {
      return this.store.upsertSessionCrewPreferences(input.sessionId, {
        lastSuggestionAt: now,
        updatedAt: now,
      });
    }
    if (input.action === 'skip') {
      return this.store.getSessionCrewPreferences(input.sessionId);
    }
    return this.store.upsertSessionCrewPreferences(input.sessionId, {
      lastSuggestionAt: now,
      updatedAt: now,
    });
  }

  async clearDismiss(sessionId: string): Promise<SessionCrewPreferences> {
    return this.store.upsertSessionCrewPreferences(sessionId, {
      suggestionsDismissed: false,
      dismissedAt: undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  async getCatalogEntry(id: string): Promise<CatalogEntry | null> {
    await this.ensureReady();
    return this.store.getCatalogEntry(id);
  }

  static createManifestFromDisk(): CatalogManifest | null {
    return loadCatalogManifest();
  }
}

export { CREW_MATCH_THRESHOLDS };
