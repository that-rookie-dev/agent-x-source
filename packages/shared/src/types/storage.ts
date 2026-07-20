export interface RecordMeta {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

import type { SessionContextKind } from './session-context.js';
import type { Crew, CrewCreateInput } from './crew.js';
import type { SessionEvent } from './session-events.js';
import type { Session } from './session.js';
import type { TurnFeedbackRecord } from './turn-feedback.js';

export interface StorableSession extends RecordMeta {
  title: string;
  status: string;
  providerId: string;
  modelId: string;
  scopePath: string;
  parentId?: string | null;
  contextKind?: SessionContextKind;
  hostCrewId?: string | null;
  /** Denormalized host crew display — survives roster removal / hub-only chats */
  hostCrewName?: string | null;
  hostCrewCallsign?: string | null;
  hostCrewTitle?: string | null;
  hostCrewColor?: string | null;
  hostCrewCatalogId?: string | null;
  hostCrewCategoryId?: string | null;
  tokenUsed: number;
  tokenAvailable: number;
  compactionCount?: number;
}

export interface StorableMessage extends RecordMeta, Record<string, unknown> {
  sessionId: string;
  role: string;
  content: string;
  toolCalls?: string;
  tokenCount: number;
  parts?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  /** External platform message_id (e.g. Telegram message_id) for inbound user messages. */
  platformMessageId?: number | null;
  /** JSON array of external platform message_ids for multi-chunk assistant replies. */
  platformMessageIds?: number[] | null;
  /** External platform chat/channel ID (e.g. Telegram chat_id). */
  platformChatId?: number | null;
}

export interface StorableMessageInput {
  sessionId: string;
  role: string;
  content: string;
  toolCalls?: string;
  tokenCount: number;
  parts?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
  platformMessageId?: number | null;
  platformMessageIds?: number[] | null;
  platformChatId?: number | null;
}

export interface StorableTokenLog extends RecordMeta {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** Runtime provider id (some adapters store this). */
  providerId?: string;
  /** Cost in USD (some adapters store this). */
  costUsd?: number | null;
  /** Crew id associated with the token log (some adapters store this). */
  crewId?: string | null;
  /** Reasoning tokens (some adapters store this). */
  reasoningTokens?: number;
}

export interface StorablePermission extends RecordMeta {
  sessionId: string;
  toolName: string;
  targetPath: string | null;
  decision: string;
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

/** Durable xAI realtime identity + rolling voice summary for one Agent-X voice session. */
export interface VoiceRealtimeState {
  sessionId: string;
  xaiConversationId: string | null;
  xaiConversationUpdatedAt: string | null;
  lastVoiceActiveAt: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
  summarySourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceRealtimeStatePatch {
  xaiConversationId?: string | null;
  xaiConversationUpdatedAt?: string | null;
  lastVoiceActiveAt?: string | null;
  summary?: string | null;
  summaryUpdatedAt?: string | null;
  summarySourceMessageId?: string | null;
  /** When true (default), never overwrite an existing non-null conversation id. */
  preserveExistingConversationId?: boolean;
}

export interface StorageAdapter {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  isConnected(): boolean;

  createSession(input: Omit<StorableSession, keyof RecordMeta> & { id?: string }): StorableSession;
  getSession(id: string): StorableSession | null;
  updateSession(id: string, updates: Partial<StorableSession>): void;
  deleteSession(id: string): void;
  listSessions(limit?: number): StorableSession[];
  listRootSessions?(limit?: number): StorableSession[];
  listChildSessions?(parentSessionId: string): StorableSession[];
  registerChildSession?(entry: {
    id: string;
    parentSessionId: string;
    kind: string;
    label?: string;
    status?: string;
  }): void;
  getSessionListKpis?(sessionId: string, base?: Session | Record<string, unknown>): SessionListKpis;

  addMessage(sessionId: string, message: StorableMessageInput): StorableMessage;
  getMessages(sessionId: string): StorableMessage[];
  deleteMessages(sessionId: string): void;
  getMessageCount(sessionId: string): number;

  insertMessage?(msg: {
    id?: string;
    sessionId: string;
    role: string;
    content: string;
    toolCalls?: unknown;
    tokenCount?: number;
    crew?: unknown;
    thinking?: string;
    plan?: string;
    parts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    attachments?: unknown;
    createdAt?: string;
    platformMessageId?: number | null;
    platformMessageIds?: number[] | null;
    platformChatId?: number | null;
  }): void;

  insertPart?(sessionId: string, part: {
    type: string;
    messageId?: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolSuccess?: boolean;
    usage?: { inputTokens: number; outputTokens: number };
  }): void;

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void;
  getTokenLogs(sessionId: string): StorableTokenLog[] | Promise<StorableTokenLog[]>;

  listCrews(): Crew[];
  getCrew(id: string): Crew | undefined;
  getDefaultCrew(): Crew | undefined;
  createCrew(input: CrewCreateInput): Crew;
  updateCrew(id: string, updates: Partial<Crew>): Crew | null;
  deleteCrew(id: string): void;
  /**
   * Flush pending durable writes (e.g. Postgres write queue).
   * Call after crew create/update/delete and before shutdown / engine reset.
   */
  flushWrites?(): Promise<void>;

  /** Task snapshot persistence (optional — primarily Postgres-backed). */
  getTaskSnapshot?(sessionId: string): Record<string, unknown> | null;
  deleteTaskSnapshot?(sessionId: string): void;
  saveTaskSnapshot?(snapshot: {
    sessionId: string;
    taskId: string;
    stepIndex: number;
    goal: string;
    planState: string;
    failureHistory: string;
  }): void;

  /** Session event persistence (optional — primarily Postgres-backed). */
  insertSessionEvent?(event: SessionEvent): void;
  getSessionEvents?(sessionId: string, sinceSequence?: number): SessionEvent[];

  /** Message/part pagination and hydration (optional — primarily Postgres-backed). */
  getMessagesPage?(
    sessionId: string,
    opts: { limit?: number; before?: string },
  ): Promise<{ messages: Array<Record<string, unknown>>; total: number; hasMore: boolean }>;
  getParts?(sessionId: string): Array<Record<string, unknown>>;
  getPartsForMessages?(
    sessionId: string,
    messages: Array<Record<string, unknown> | StorableMessage>,
  ): Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
  ensureSessionHydrated?(sessionId: string): Promise<void> | void;
  updateMessage?(
    sessionId: string,
    messageId: string,
    patch: {
      content?: string;
      parts?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
      attachments?: unknown;
      platformMessageId?: number | null;
      platformMessageIds?: number[] | null;
      platformChatId?: number | null;
    },
  ): void;

  /** Checkpoints (optional — primarily Postgres-backed). */
  listCheckpoints?(sessionId: string): Array<{ id: string; label: string; createdAt: string; messageCount: number }>;
  createCheckpoint?(sessionId: string, label: string): { id: string } | null;
  restoreCheckpoint?(sessionId: string, checkpointId: string): boolean;
  deleteCheckpoint?(sessionId: string, checkpointId: string): boolean;

  /** Session content management (optional — primarily Postgres-backed). */
  archiveSessionMessages?(sessionId: string): void;
  purgeSessionContent?(sessionId: string): void;
  deleteLastMessages?(sessionId: string, count: number, roles: string[]): void;

  /** Turn feedback persistence (optional — primarily Postgres-backed). */
  upsertTurnFeedback?(feedback: TurnFeedbackRecord): void;
  getTurnFeedbackBySession?(sessionId: string): Array<Record<string, unknown>>;

  /** Resume state persistence (optional — primarily Postgres-backed). */
  getSessionResumeState?(sessionId: string): Record<string, unknown> | null;
  setSessionResumeState?(sessionId: string, state: {
    kind: string;
    messageId: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): void;
  clearSessionResumeState?(sessionId: string): void;

  /** xAI realtime conversation id + rolling voice summary (optional — Postgres-backed). */
  getVoiceRealtimeState?(sessionId: string): Promise<VoiceRealtimeState | null>;
  upsertVoiceRealtimeState?(sessionId: string, patch: VoiceRealtimeStatePatch): Promise<VoiceRealtimeState>;
  touchVoiceRealtimeActive?(sessionId: string, at?: string): Promise<void> | void;

  /** Crew catalog store accessor (optional — primarily Postgres-backed). */
  getCrewCatalogStore?(): { getCatalogEntry: (id: string) => Promise<{ categoryId?: string } | null> };

  /** Runtime introspection (optional — primarily Postgres-backed). */
  getInfo?(): { dbMode: string; sessionCount: number; filesystemRecovered: number; schemaVersion: number };
  /** Returns the underlying pg Pool (optional — primarily Postgres-backed). */
  getPool?(): { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

  /** Crew state persistence (optional — primarily Postgres-backed). */
  saveCrewState?(state: { crewId: string; sessionId: string; enabled: boolean; lastActive?: string; messageCount?: number }): void;
  loadCrewStates?(sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }>;
  addCrewFeedback?(feedback: { id: string; sessionId: string; crewId: string; positive: boolean; comment: string | null; createdAt: string }): void;
  getCrewFeedback?(crewId: string): Array<Record<string, unknown>>;

  /** Tool execution persistence (optional — primarily Postgres-backed). */
  addToolExecution?(exec: {
    id: string;
    sessionId: string;
    toolName: string;
    input: string;
    output: string;
    success: boolean;
    elapsedMs: number;
  }): void;

  clearAll(): void;
  close(): void;
}
