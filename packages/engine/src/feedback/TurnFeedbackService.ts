import { generateId } from '@agentx/shared';
import type { SessionContextKind, TurnFeedbackRating, TurnFeedbackRecord } from '@agentx/shared';
import { buildTurnFeedbackContext } from '@agentx/shared';
import type { StorageAdapter } from '@agentx/shared';

export interface TurnFeedbackStore {
  upsertTurnFeedback?(feedback: {
    id: string;
    sessionId: string;
    messageId: string;
    contextKind: SessionContextKind;
    crewId?: string | null;
    rating: TurnFeedbackRating;
    turnSummary?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  }): void;
  getTurnFeedbackBySession?(sessionId: string): Array<Record<string, unknown>>;
}

function mapRow(row: Record<string, unknown>): TurnFeedbackRecord {
  let metadata: Record<string, unknown> | null = null;
  const rawMeta = row['metadata'];
  if (typeof rawMeta === 'string' && rawMeta) {
    try { metadata = JSON.parse(rawMeta) as Record<string, unknown>; } catch { metadata = null; }
  } else if (rawMeta && typeof rawMeta === 'object') {
    metadata = rawMeta as Record<string, unknown>;
  }

  return {
    id: String(row['id'] ?? ''),
    sessionId: String(row['session_id'] ?? row['sessionId'] ?? ''),
    messageId: String(row['message_id'] ?? row['messageId'] ?? ''),
    contextKind: (row['context_kind'] ?? row['contextKind'] ?? 'agent_x') as SessionContextKind,
    crewId: (row['crew_id'] ?? row['crewId'] ?? null) as string | null,
    rating: String(row['rating'] ?? 'skipped') as TurnFeedbackRating,
    turnSummary: (row['turn_summary'] ?? row['turnSummary'] ?? null) as string | null,
    metadata,
    createdAt: String(row['created_at'] ?? row['createdAt'] ?? new Date().toISOString()),
  };
}

/** Session-scoped turn feedback — persistence + prompt context. */
export class TurnFeedbackService {
  constructor(private getStore: () => StorageAdapter | null) {}

  record(input: {
    sessionId: string;
    messageId: string;
    contextKind: SessionContextKind;
    crewId?: string | null;
    rating: TurnFeedbackRating;
    turnSummary?: string | null;
    metadata?: Record<string, unknown> | null;
  }): TurnFeedbackRecord {
    const store = this.getStore();
    const entry: TurnFeedbackRecord = {
      id: generateId(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      contextKind: input.contextKind,
      crewId: input.crewId ?? null,
      rating: input.rating,
      turnSummary: input.turnSummary ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };

    store?.upsertTurnFeedback?.({
      id: entry.id,
      sessionId: entry.sessionId,
      messageId: entry.messageId,
      contextKind: entry.contextKind,
      crewId: entry.crewId,
      rating: entry.rating,
      turnSummary: entry.turnSummary,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    });

    return entry;
  }

  getSessionFeedback(sessionId: string): TurnFeedbackRecord[] {
    const store = this.getStore();
    const rows = store?.getTurnFeedbackBySession?.(sessionId) ?? [];
    return rows.map((row) => mapRow(row));
  }

  getFeedbackForMessage(sessionId: string, messageId: string): TurnFeedbackRecord | null {
    return this.getSessionFeedback(sessionId).find((e) => e.messageId === messageId) ?? null;
  }

  buildPromptContext(sessionId: string): string {
    return buildTurnFeedbackContext(this.getSessionFeedback(sessionId));
  }
}
