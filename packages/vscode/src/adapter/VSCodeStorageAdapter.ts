import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  StorageAdapter,
  StorableSession,
  StorableMessage,
  StorableTokenLog,
  StorablePermission,
  RecordMeta,
} from '@agentx/shared';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

interface SessionsFile {
  sessions: StorableSession[];
}

interface MessagesFile {
  messages: StorableMessage[];
}

interface TokenLogsFile {
  logs: StorableTokenLog[];
}

interface PermissionsFile {
  permissions: StorablePermission[];
}

export class VSCodeStorageAdapter implements StorageAdapter {
  private storageDir: string;
  private connected = false;

  private sessionsPath: string;
  private messagesPath: string;
  private tokenLogsPath: string;
  private permissionsPath: string;

  constructor(globalStoragePath: string) {
    this.storageDir = path.join(globalStoragePath, 'agentx-data');
    this.sessionsPath = path.join(this.storageDir, 'sessions.json');
    this.messagesPath = path.join(this.storageDir, 'messages.json');
    this.tokenLogsPath = path.join(this.storageDir, 'token-logs.json');
    this.permissionsPath = path.join(this.storageDir, 'permissions.json');
  }

  connect(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!fs.existsSync(this.sessionsPath)) {
      this.writeJSON(this.sessionsPath, { sessions: [] });
    }
    if (!fs.existsSync(this.messagesPath)) {
      this.writeJSON(this.messagesPath, { messages: [] });
    }
    if (!fs.existsSync(this.tokenLogsPath)) {
      this.writeJSON(this.tokenLogsPath, { logs: [] });
    }
    if (!fs.existsSync(this.permissionsPath)) {
      this.writeJSON(this.permissionsPath, { permissions: [] });
    }

    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── Sessions ───

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession {
    const data = this.readSessions();
    const session: StorableSession = {
      id: generateId(),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      ...input,
    };
    data.sessions.push(session);
    this.writeSessions(data);
    return session;
  }

  getSession(id: string): StorableSession | null {
    const data = this.readSessions();
    return data.sessions.find((s) => s.id === id) ?? null;
  }

  updateSession(id: string, updates: Partial<StorableSession>): void {
    const data = this.readSessions();
    const idx = data.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const existing = data.sessions[idx]!;
    data.sessions[idx] = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowISO(),
    } as StorableSession;
    this.writeSessions(data);
  }

  deleteSession(id: string): void {
    const data = this.readSessions();
    data.sessions = data.sessions.filter((s) => s.id !== id);
    this.writeSessions(data);

    this.deleteMessages(id);
  }

  listSessions(limit?: number): StorableSession[] {
    const data = this.readSessions();
    const sorted = data.sessions.sort(
      (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  // ─── Messages ───

  addMessage(sessionId: string, message: Omit<StorableMessage, 'id' | 'createdAt' | 'sessionId'>): StorableMessage {
    const data = this.readMessages();
    const record: StorableMessage = {
      id: generateId(),
      createdAt: nowISO(),
      sessionId,
      ...message,
    } as StorableMessage;
    data.messages.push(record);
    this.writeMessages(data);
    return record;
  }

  getMessages(sessionId: string): StorableMessage[] {
    const data = this.readMessages();
    return data.messages
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  deleteMessages(sessionId: string): void {
    const data = this.readMessages();
    data.messages = data.messages.filter((m) => m.sessionId !== sessionId);
    this.writeMessages(data);
  }

  getMessageCount(sessionId: string): number {
    const data = this.readMessages();
    return data.messages.filter((m) => m.sessionId === sessionId).length;
  }

  // ─── Token Logs ───

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt' | 'sessionId'>): void {
    const data = this.readTokenLogs();
    const record: StorableTokenLog = {
      id: generateId(),
      createdAt: nowISO(),
      sessionId,
      ...log,
    };
    data.logs.push(record);
    this.writeTokenLogs(data);
  }

  getTokenLogs(sessionId: string): StorableTokenLog[] {
    const data = this.readTokenLogs();
    return data.logs
      .filter((l) => l.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ─── Permissions ───

  addPermission(sessionId: string, perm: Omit<StorablePermission, 'id' | 'createdAt' | 'sessionId'>): void {
    const data = this.readPermissions();
    const record: StorablePermission = {
      id: generateId(),
      createdAt: nowISO(),
      sessionId,
      ...perm,
    };
    data.permissions.push(record);
    this.writePermissions(data);
  }

  getPermissions(sessionId: string): StorablePermission[] {
    const data = this.readPermissions();
    return data.permissions
      .filter((p) => p.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ─── Bulk Operations ───

  clearAll(): void {
    this.writeSessions({ sessions: [] });
    this.writeMessages({ messages: [] });
    this.writeTokenLogs({ logs: [] });
    this.writePermissions({ permissions: [] });
  }

  close(): void {
    this.disconnect();
  }

  // ─── Private I/O ───

  private readJSON<T>(filePath: string): T {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return {} as T;
    }
  }

  private writeJSON(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private readSessions(): SessionsFile {
    const data = this.readJSON<SessionsFile>(this.sessionsPath);
    if (!data.sessions) data.sessions = [];
    return data;
  }

  private writeSessions(data: SessionsFile): void {
    this.writeJSON(this.sessionsPath, data);
  }

  private readMessages(): MessagesFile {
    const data = this.readJSON<MessagesFile>(this.messagesPath);
    if (!data.messages) data.messages = [];
    return data;
  }

  private writeMessages(data: MessagesFile): void {
    this.writeJSON(this.messagesPath, data);
  }

  private readTokenLogs(): TokenLogsFile {
    const data = this.readJSON<TokenLogsFile>(this.tokenLogsPath);
    if (!data.logs) data.logs = [];
    return data;
  }

  private writeTokenLogs(data: TokenLogsFile): void {
    this.writeJSON(this.tokenLogsPath, data);
  }

  private readPermissions(): PermissionsFile {
    const data = this.readJSON<PermissionsFile>(this.permissionsPath);
    if (!data.permissions) data.permissions = [];
    return data;
  }

  private writePermissions(data: PermissionsFile): void {
    this.writeJSON(this.permissionsPath, data);
  }
}
