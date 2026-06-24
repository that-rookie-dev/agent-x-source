import type { SessionContextKind } from './session-context.js';

export interface Session {
  id: string;
  title: string;
  parentId?: string | null;
  providerId: string;
  modelId: string;
  scopePath: string;
  mode: 'agent' | 'plan';
  /** agent_x (default) or crew_private for 1:1 user↔crew chat */
  contextKind?: SessionContextKind;
  /** Set when contextKind is crew_private */
  hostCrewId?: string | null;
  hyperdrive?: boolean;
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
