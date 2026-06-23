/**
 * Normalize session field names so callers can use either SQLite (tokensUsed)
 * or Postgres/StorableSession (tokenUsed) conventions interchangeably.
 */
export function normalizeSessionUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...updates };
  if (normalized['tokensUsed'] != null && normalized['tokenUsed'] == null) {
    normalized['tokenUsed'] = normalized['tokensUsed'];
  }
  if (normalized['tokenUsed'] != null && normalized['tokensUsed'] == null) {
    normalized['tokensUsed'] = normalized['tokenUsed'];
  }
  return normalized;
}

export interface SessionListKpis {
  messageCount: number;
  childSessionCount: number;
  crewCount: number;
  crewCallsigns: string[];
  totalCostUsd: number;
  compactionCount: number;
  tokensUsed: number;
  tokenAvailable: number;
  tokenUsagePct: number;
}

export const EMPTY_SESSION_KPIS: SessionListKpis = {
  messageCount: 0,
  childSessionCount: 0,
  crewCount: 0,
  crewCallsigns: [],
  totalCostUsd: 0,
  compactionCount: 0,
  tokensUsed: 0,
  tokenAvailable: 128_000,
  tokenUsagePct: 0,
};
