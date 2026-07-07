import type { SessionContextKind } from '../types/session-context.js';
import { isSuperSessionId } from './channel-session.js';

/** Super sessions use global memory fabric (session_id NULL); all others are session-scoped. */
export function isMemoryFabricSuperSession(
  sessionId: string | null | undefined,
  contextKind?: SessionContextKind | null,
): boolean {
  if (isSuperSessionId(sessionId)) return true;
  return contextKind === 'agent_x_core';
}

/** session_id column for memory node writes (undefined → NULL / global bucket). */
export function resolveMemoryFabricWriteSessionId(
  sessionId: string,
  contextKind?: SessionContextKind | null,
): string | undefined {
  if (isMemoryFabricSuperSession(sessionId, contextKind)) return undefined;
  return sessionId;
}

/** sessionId filter for vectorSearch: null = global nodes, string = scoped session only. */
export function resolveMemoryFabricSearchSessionFilter(
  sessionId: string,
  contextKind?: SessionContextKind | null,
): string | null {
  if (isMemoryFabricSuperSession(sessionId, contextKind)) return null;
  return sessionId;
}
