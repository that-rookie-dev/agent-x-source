import type { SessionContextKind } from './session-context.js';

export interface Session {
  id: string;
  title: string;
  parentId?: string | null;
  providerId: string;
  modelId: string;
  scopePath: string;
  /** agent_x (default) or crew_private for 1:1 user↔crew chat */
  contextKind?: SessionContextKind;
  /** Set when contextKind is crew_private */
  hostCrewId?: string | null;
  hostCrewName?: string | null;
  hostCrewCallsign?: string | null;
  hostCrewTitle?: string | null;
  hostCrewColor?: string | null;
  hostCrewCatalogId?: string | null;
  hostCrewCategoryId?: string | null;
  /** Persisted list-section day key (`YYYY-MM-DD`), set at create. */
  listDayKey?: string | null;
  /** Persisted absolute day label for session list dividers. */
  listDayLabel?: string | null;
  /** Runtime-only flag loaded from the session-local permission file. */
  bypassPermissions?: boolean;
  tokenUsed: number;
  tokenAvailable: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface SessionCreateInput {
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenAvailable: number;
}
