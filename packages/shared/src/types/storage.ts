export interface RecordMeta {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

import type { SessionContextKind } from './session-context.js';

export interface StorableSession extends RecordMeta {
  title: string;
  status: string;
  providerId: string;
  modelId: string;
  scopePath: string;
  mode?: string;
  parentId?: string | null;
  contextKind?: SessionContextKind;
  hostCrewId?: string | null;
  hyperdrive?: boolean;
  tokenUsed: number;
  tokenAvailable: number;
  compactionCount?: number;
}

export interface StorableMessage extends RecordMeta {
  sessionId: string;
  role: string;
  content: string;
  toolCalls?: string;
  tokenCount: number;
  parts?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface StorableTokenLog extends RecordMeta {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface StorablePermission extends RecordMeta {
  sessionId: string;
  toolName: string;
  targetPath: string | null;
  decision: string;
}

export interface StorageAdapter {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  isConnected(): boolean;

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession;
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
  getSessionListKpis?(sessionId: string, base?: Record<string, unknown>): Record<string, unknown>;

  addMessage(sessionId: string, message: Omit<StorableMessage, 'id' | 'createdAt'>): StorableMessage;
  getMessages(sessionId: string): StorableMessage[];
  deleteMessages(sessionId: string): void;
  getMessageCount(sessionId: string): number;

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void;
  getTokenLogs(sessionId: string): StorableTokenLog[] | Promise<StorableTokenLog[]>;

  addPermission(sessionId: string, perm: Omit<StorablePermission, 'id' | 'createdAt'>): void;
  getPermissions(sessionId: string): StorablePermission[] | Promise<StorablePermission[]>;

  clearAll(): void;
  close(): void;
}
