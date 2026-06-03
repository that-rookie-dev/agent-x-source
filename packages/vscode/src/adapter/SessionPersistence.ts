import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '@agentx/shared';
import type { ChatMessage } from './types';

const SESSIONS_DIR_NAME = 'sessions';

export class SessionPersistence {
  private sessionsDir: string;
  private writeBuffers = new Map<string, ChatMessage[]>();

  constructor() {
    this.sessionsDir = path.join(getDataDir(), SESSIONS_DIR_NAME);
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  getSessionDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }

  initializeSession(sessionId: string): void {
    const dir = this.getSessionDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'checkpoints'), { recursive: true });

    const contextPath = path.join(dir, 'context.txt');
    if (!fs.existsSync(contextPath)) {
      fs.writeFileSync(contextPath, '', 'utf-8');
    }

    const conversationPath = path.join(dir, 'conversation.json');
    if (!fs.existsSync(conversationPath)) {
      fs.writeFileSync(conversationPath, '[]', 'utf-8');
    }

    this.writeBuffers.set(sessionId, []);
  }

  deleteSessionDirectory(sessionId: string): void {
    const dir = this.getSessionDir(sessionId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    this.writeBuffers.delete(sessionId);
  }

  persistMessage(sessionId: string, message: ChatMessage): void {
    const buffer = this.writeBuffers.get(sessionId);
    if (buffer) {
      buffer.push(message);
    }

    this.appendToConversationJson(sessionId, message);
    this.appendToContextTxt(sessionId, message);
  }

  saveMessage(sessionId: string, message: ChatMessage): void {
    this.persistMessage(sessionId, message);
  }

  loadMessages(sessionId: string): ChatMessage[] {
    const conversationPath = path.join(this.getSessionDir(sessionId), 'conversation.json');
    if (!fs.existsSync(conversationPath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(conversationPath, 'utf-8');
      const parsed = JSON.parse(data) as ChatMessage[];
      return parsed;
    } catch {
      return [];
    }
  }

  logToolExecuting(sessionId: string, tool: string, description: string): void {
    const contextPath = path.join(this.getSessionDir(sessionId), 'context.txt');
    const line = `[${new Date().toISOString()}] TOOL_EXECUTING: ${tool} — ${description}\n`;
    this.atomicAppend(contextPath, line);
  }

  logToolComplete(sessionId: string, tool: string, success: boolean, elapsed: number): void {
    const contextPath = path.join(this.getSessionDir(sessionId), 'context.txt');
    const status = success ? 'SUCCESS' : 'FAILED';
    const line = `[${new Date().toISOString()}] TOOL_COMPLETE: ${tool} — ${status} (${elapsed}ms)\n`;
    this.atomicAppend(contextPath, line);
  }

  flushSession(sessionId: string): void {
    this.writeBuffers.delete(sessionId);
  }

  getSessionFileSize(sessionId: string): number {
    const conversationPath = path.join(this.getSessionDir(sessionId), 'conversation.json');
    try {
      const stat = fs.statSync(conversationPath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  listSessionDirectories(): string[] {
    try {
      return fs.readdirSync(this.sessionsDir).filter((name) => {
        const fullPath = path.join(this.sessionsDir, name);
        return fs.statSync(fullPath).isDirectory();
      });
    } catch {
      return [];
    }
  }

  private appendToConversationJson(sessionId: string, message: ChatMessage): void {
    const conversationPath = path.join(this.getSessionDir(sessionId), 'conversation.json');
    const tmpPath = conversationPath + '.tmp';

    let existing: ChatMessage[] = [];
    try {
      if (fs.existsSync(conversationPath)) {
        const data = fs.readFileSync(conversationPath, 'utf-8');
        existing = JSON.parse(data) as ChatMessage[];
      }
    } catch {
      existing = [];
    }

    existing.push(message);

    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2), 'utf-8');
    fs.renameSync(tmpPath, conversationPath);
  }

  private appendToContextTxt(sessionId: string, message: ChatMessage): void {
    const contextPath = path.join(this.getSessionDir(sessionId), 'context.txt');
    const tmpPath = contextPath + '.tmp';

    const prefix = message.role === 'user' ? 'USER' : message.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
    const line = `[${new Date(message.createdAt).toISOString()}] ${prefix}: ${message.content}\n\n`;

    let existing = '';
    try {
      if (fs.existsSync(contextPath)) {
        existing = fs.readFileSync(contextPath, 'utf-8');
      }
    } catch {
      existing = '';
    }

    fs.writeFileSync(tmpPath, existing + line, 'utf-8');
    fs.renameSync(tmpPath, contextPath);
  }

  private atomicAppend(filePath: string, content: string): void {
    const tmpPath = filePath + '.tmp';
    let existing = '';
    try {
      if (fs.existsSync(filePath)) {
        existing = fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      existing = '';
    }
    fs.writeFileSync(tmpPath, existing + content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  dispose(): void {
    this.writeBuffers.clear();
  }
}
