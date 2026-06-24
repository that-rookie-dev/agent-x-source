import type { Crew, CrewMatchCandidate } from '@agentx/shared';
import {
  assessCrewNeed,
  buildTaskContextForCrewRouting,
  hasTaskSignals,
  shouldSkipAutonomousCrewRouting,
} from '../agent/crew-auto-compose.js';
import type { CrewMember } from '../agent/CrewOrchestrator.js';

export const CREW_MATCH_THRESHOLDS = {
  /** Minimum normalized score to include in suggestion list. */
  minCandidateScore: 0.28,
  /** Minimum confidence to show the suggestion popup. */
  minSuggestConfidence: 0.38,
  /** Higher bar when a crew is already active — avoids noise on continuations. */
  minSuggestWithActiveCrew: 0.52,
  /** Max candidates shown in popup. */
  maxCandidates: 5,
  /** Boost for user-created crews. */
  customBoost: 0.15,
  /** Boost when crew already used in session. */
  sessionUsageBoost: 0.08,
  /** Boost when crew is enabled on roster. */
  rosterEnabledBoost: 0.05,
} as const;

export interface RawMatchRow {
  id: string;
  origin: CrewMatchCandidate['origin'];
  callsign: string;
  name: string;
  title: string;
  categoryId?: string;
  categoryLabel?: string;
  description: string;
  expertise: string[];
  traits: string[];
  tone?: string;
  catalogId?: string;
  onRoster: boolean;
  enabled?: boolean;
  ftsRank: number;
  systemPrompt?: string;
  requiresMedicalDisclaimer?: boolean;
}

function normalizeFtsScores(rows: RawMatchRow[]): Map<string, number> {
  if (rows.length === 0) return new Map();
  const ranks = rows.map((r) => r.ftsRank);
  const max = Math.max(...ranks);
  const min = Math.min(...ranks);
  const span = max - min || 1;
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.id, (row.ftsRank - min) / span);
  }
  return out;
}

function crewMemberFromRow(row: RawMatchRow): CrewMember {
  const crew: Crew = {
    id: row.id,
    name: row.name,
    title: row.title,
    callsign: row.callsign,
    systemPrompt: row.systemPrompt ?? '',
    description: row.description,
    expertise: row.expertise,
    traits: row.traits,
    emotion: row.tone as Crew['emotion'],
    source: row.origin === 'custom' ? 'custom' : 'hub',
    catalogId: row.catalogId,
    isDefault: false,
    enabled: row.enabled ?? true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    crew,
    expertise: row.expertise,
    active: row.enabled !== false,
    tokensUsedThisSession: 0,
    cpuTimeMs: 0,
  };
}

function heuristicScore(task: string, row: RawMatchRow): { score: number; reasons: string[] } {
  const member = crewMemberFromRow(row);
  const assessment = assessCrewNeed(task, [member]);
  if (assessment.members.length === 0) {
    return { score: 0, reasons: [] };
  }
  return {
    score: assessment.confidence,
    reasons: assessment.reasons,
  };
}

export function scoreMatchCandidates(
  task: string,
  rows: RawMatchRow[],
  opts?: { sessionMessageCounts?: Map<string, number> },
): CrewMatchCandidate[] {
  if (rows.length === 0) return [];

  const ftsNorm = normalizeFtsScores(rows);
  const scored: CrewMatchCandidate[] = [];

  for (const row of rows) {
    const fts = ftsNorm.get(row.id) ?? 0;
    const { score: heuristic, reasons: heuristicReasons } = heuristicScore(task, row);

    let originBoost = 0;
    if (row.origin === 'custom') originBoost += CREW_MATCH_THRESHOLDS.customBoost;
    if (row.onRoster && row.enabled) originBoost += CREW_MATCH_THRESHOLDS.rosterEnabledBoost;
    const usage = opts?.sessionMessageCounts?.get(row.id) ?? 0;
    if (usage > 0) originBoost += CREW_MATCH_THRESHOLDS.sessionUsageBoost;

    const matchScore = Math.min(
      1,
      fts * 0.4 + heuristic * 0.45 + originBoost,
    );

    if (matchScore < CREW_MATCH_THRESHOLDS.minCandidateScore) continue;

    scored.push({
      id: row.id,
      origin: row.origin,
      callsign: row.callsign,
      name: row.name,
      title: row.title,
      categoryId: row.categoryId,
      categoryLabel: row.categoryLabel,
      description: row.description,
      expertise: row.expertise,
      traits: row.traits,
      tone: row.tone,
      matchScore,
      reasons: heuristicReasons.slice(0, 4),
      onRoster: row.onRoster,
      enabled: row.enabled,
      catalogId: row.catalogId,
      requiresMedicalDisclaimer: row.requiresMedicalDisclaimer,
    });
  }

  return scored
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, CREW_MATCH_THRESHOLDS.maxCandidates);
}

export interface SuggestionGateInput {
  message: string;
  priorUserMessages?: string[];
  dismissed: boolean;
  hasAtMention: boolean;
  explicitCrewRequest: boolean;
}

export function evaluateSuggestionGate(input: SuggestionGateInput): {
  pass: boolean;
  task: string;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (input.hasAtMention) {
    reasons.push('at-mention');
    return { pass: false, task: input.message, reasons };
  }
  if (input.dismissed && !input.explicitCrewRequest) {
    reasons.push('session-dismissed');
    return { pass: false, task: input.message, reasons };
  }
  const task = buildTaskContextForCrewRouting(input.message, input.priorUserMessages);
  if (shouldSkipAutonomousCrewRouting(task)) {
    reasons.push('agent-x-direct');
    return { pass: false, task, reasons };
  }
  if (!hasTaskSignals(task)) {
    reasons.push('no-task-signals');
    return { pass: false, task, reasons };
  }
  return { pass: true, task, reasons };
}

export function shouldShowSuggestion(
  candidates: CrewMatchCandidate[],
  minConfidence: number = CREW_MATCH_THRESHOLDS.minSuggestConfidence,
): boolean {
  if (candidates.length === 0) return false;
  const top = candidates[0]!;
  return top.matchScore >= minConfidence;
}

export function taskSummaryFromMessage(task: string): string {
  const trimmed = task.trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}...`;
}
