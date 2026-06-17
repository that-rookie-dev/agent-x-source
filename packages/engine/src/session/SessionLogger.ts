import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '@agentx/shared';

export interface SessionLogEntry {
  ts: number;
  type: 'user_message' | 'assistant_message' | 'system_prompt'
    | 'llm_request' | 'llm_response_raw' | 'llm_response_chunk' | 'llm_response'
    | 'tool_call' | 'tool_result' | 'tool_error'
    | 'error_user' | 'error_api' | 'warning' | 'info';
  data: Record<string, unknown>;
}

/**
 * Per-session logger that writes every action as NDJSON (newline-delimited JSON)
 * to `~/.local/share/agentx/sessions/<sessionId>/logs/<ts>.ndjson`.
 *
 * Each log file is named by creation timestamp (epoch ms), so the latest file
 * is always the one with the highest numeric name. A new file is created on
 * every `init()` call (one per session start).
 */
export class SessionLogger {
  private sessionId: string;
  private logDir: string;
  private logPath: string;
  private opened = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    const dataDir = getDataDir();
    this.logDir = join(dataDir, 'sessions', sessionId, 'logs');
    this.logPath = join(this.logDir, `${Date.now()}.ndjson`);
  }

  init(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
    this.opened = true;
    this.write({ type: 'info', data: { msg: 'session_logger_started', sessionId: this.sessionId } });
  }

  close(): void {
    if (this.opened) {
      this.write({ type: 'info', data: { msg: 'session_logger_stopped' } });
      this.opened = false;
    }
  }

  log(entry: Omit<SessionLogEntry, 'ts'>): void {
    if (!this.opened) return;
    this.write(entry);
  }

  logUserMessage(content: string, extra?: Record<string, unknown>): void {
    this.log({ type: 'user_message', data: { content, ...extra } });
  }

  logAssistantMessage(content: string, model: string, usage?: Record<string, unknown>): void {
    this.log({ type: 'assistant_message', data: { content, model, usage } });
  }

  logSystemPrompt(prompt: string): void {
    this.log({ type: 'system_prompt', data: { prompt } });
  }

  logLLMRequest(provider: string, model: string, messages: unknown[], tools?: unknown[]): void {
    this.log({ type: 'llm_request', data: { provider, model, messages, tools } });
  }

  logLLMResponseRaw(provider: string, model: string, content: string, usage?: Record<string, unknown>): void {
    this.log({ type: 'llm_response_raw', data: { provider, model, content, usage } });
  }

  logLLMResponseChunk(provider: string, model: string, chunk: Record<string, unknown>): void {
    this.log({ type: 'llm_response_chunk', data: { provider, model, chunk } });
  }

  logToolCall(tool: string, args: Record<string, unknown>): void {
    this.log({ type: 'tool_call', data: { tool, args } });
  }

  logToolResult(tool: string, success: boolean, output: string, elapsed: number): void {
    this.log({ type: 'tool_result', data: { tool, success, output, elapsed } });
  }

  logToolError(tool: string, error: string): void {
    this.log({ type: 'tool_error', data: { tool, error } });
  }

  logErrorUser(error: string, code?: string, category?: string): void {
    this.log({ type: 'error_user', data: { error, code, category } });
  }

  logErrorAPI(provider: string, endpoint: string, status: number, body: string): void {
    this.log({ type: 'error_api', data: { provider, endpoint, status, body } });
  }

  logWarning(message: string): void {
    this.log({ type: 'warning', data: { message } });
  }

  logInfo(type: string, data: Record<string, unknown>): void {
    this.log({ type: 'info', data: { type, ...data } });
  }

  private write(entry: Omit<SessionLogEntry, 'ts'>): void {
    try {
      const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
      appendFileSync(this.logPath, line, 'utf-8');
    } catch {
      // best-effort
    }
  }
}
