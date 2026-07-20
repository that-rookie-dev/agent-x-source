import type { ChatMessage, SessionInfo } from '../api';
import { mapRestoreHistoryMessage } from './utils';
import type { UIMessage } from './types';
import type { TurnFeedbackRating } from '@agentx/shared/browser';
import { sessionHostCrewDisplay } from '../utils/crew-display';

/** Initial messages loaded per role (user + assistant) on session open. */
export const CHAT_INITIAL_MESSAGES_PER_ROLE = 5;
/** Super-session (Agent-X core) UI window — 25 per role ≈ 50 visible messages. */
export const CORE_SESSION_MESSAGES_PER_ROLE = 25;

export interface SessionShellPatch {
  crewPrivate: boolean;
  privateHost: { name: string; callsign: string; title?: string } | null;
  privateHostCrewId: string | null;
  bypassPermissions?: boolean;
  title: string;
}

export function buildSessionShellPatch(session: SessionInfo): SessionShellPatch {
  const kind = session.contextKind ?? 'agent_x';
  const crewPrivate = kind === 'crew_private';
  const title = session.title ?? `Session ${session.id.slice(0, 8)}`;
  if (kind === 'agent_x_core') {
    return {
      crewPrivate: false,
      privateHost: null,
      privateHostCrewId: null,
      bypassPermissions: session.bypassPermissions,
      title,
    };
  }
  if (!crewPrivate) {
    return {
      crewPrivate: false,
      privateHost: null,
      privateHostCrewId: null,
      bypassPermissions: session.bypassPermissions,
      title,
    };
  }
  const { displayName, displayCallsign } = sessionHostCrewDisplay(session);
  return {
    crewPrivate: true,
    privateHost: {
      name: displayName,
      callsign: displayCallsign,
      title: session.hostCrewTitle,
    },
    privateHostCrewId: session.hostCrewId ?? null,
    bypassPermissions: session.bypassPermissions,
    title,
  };
}

export function applyTurnFeedbackRows(
  msgs: UIMessage[],
  rows?: Array<Record<string, unknown>>,
): UIMessage[] {
  if (!rows?.length) return msgs;
  const byMessage = new Map<string, TurnFeedbackRating>();
  for (const row of rows) {
    const messageId = String(row['message_id'] ?? row['messageId'] ?? '');
    const rating = String(row['rating'] ?? '') as TurnFeedbackRating;
    if (messageId && (rating === 'positive' || rating === 'negative' || rating === 'skipped')) {
      byMessage.set(messageId, rating);
    }
  }
  if (byMessage.size === 0) return msgs;
  return msgs.map((m) => {
    const rating = byMessage.get(m.id);
    return rating ? { ...m, turnFeedback: { rating } } : m;
  });
}

export function mapHistoryToUiMessages(historyMsgs: ChatMessage[]): UIMessage[] {
  const visible = historyMsgs.filter((m) => m.role !== 'part' && m.role !== 'system');
  return visible.map((m) => {
    const restored = mapRestoreHistoryMessage(m as unknown as Record<string, unknown>);
    return {
      ...restored,
      id: m.id || crypto.randomUUID(),
      role: m.role,
      crew: m.crew,
      streaming: false,
      subAgents: m.subAgents?.map((sa) => ({ ...sa, status: 'done' as const })),
      plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
    };
  }) as unknown as UIMessage[];
}
