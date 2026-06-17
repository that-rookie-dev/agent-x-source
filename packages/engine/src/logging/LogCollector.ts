import { EventEmitter } from 'node:events';
import type { LogEntry } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { SessionLogger } from '../session/SessionLogger.js';

export interface LogCollectorEvent {
  entry: LogEntry;
  index: number;
}

const MAX_BUFFER = 5000;

export class LogCollector extends EventEmitter {
  private buffer: LogEntry[] = [];
  private index = 0;
  private _originalLogger: { error: Function; warn: Function; info: Function } | null = null;

  get entries(): readonly LogEntry[] {
    return this.buffer;
  }

  get count(): number {
    return this.buffer.length;
  }

  push(entry: LogEntry): void {
    this.index++;
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.shift();
    }
    this.emit('entry', { entry, index: this.index } satisfies LogCollectorEvent);
  }

  clear(): void {
    this.buffer = [];
    this.index = 0;
  }

  query(options?: { level?: string; code?: string; search?: string; limit?: number; since?: number }): LogEntry[] {
    let results = [...this.buffer];

    if (options?.level) {
      results = results.filter((e) => e.level === options.level);
    }
    if (options?.code) {
      results = results.filter((e) => e.code === options.code);
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      results = results.filter(
        (e) =>
          e.message.toLowerCase().includes(s) ||
          e.code.toLowerCase().includes(s),
      );
    }
    if (options?.since != null) {
      results = results.filter((e) => new Date(e.timestamp).getTime() >= options.since!);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  hook(logger: { error: Function; warn: Function; info: Function }): void {
    if (this._originalLogger) return;
    this._originalLogger = { error: logger.error.bind(logger), warn: logger.warn.bind(logger), info: logger.info.bind(logger) };

    const self = this;
    logger.error = function (code: string, error: unknown, context?: Record<string, unknown>) {
      self._originalLogger!.error(code, error, context);
      self.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        code,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context,
      });
    };
    logger.warn = function (code: string, message: string, context?: Record<string, unknown>) {
      self._originalLogger!.warn(code, message, context);
      self.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        code,
        message,
        context,
      });
    };
    logger.info = function (code: string, message: string, context?: Record<string, unknown>) {
      self._originalLogger!.info(code, message, context);
      self.push({
        timestamp: new Date().toISOString(),
        level: 'info',
        code,
        message,
        context,
      });
    };
  }

  hookSessionLogger(sessionLogger: SessionLogger): void {
    const originalLog = sessionLogger.log.bind(sessionLogger);
    const self = this;
    sessionLogger.log = function (entry: Parameters<SessionLogger['log']>[0]) {
      originalLog(entry);
      const level = entry.type.startsWith('error') ? 'error' : entry.type === 'warning' ? 'warn' : 'info';
      const msg = typeof entry.data === 'object' ? JSON.stringify(entry.data, null, 2) : String(entry.data);
      self.push({
        timestamp: new Date().toISOString(),
        level: level as 'error' | 'warn' | 'info',
        code: entry.type,
        message: msg.length > 500 ? msg.slice(0, 500) + '...' : msg,
        context: entry.data as Record<string, unknown>,
      });
    };
  }
}

let _collector: LogCollector | null = null;

export function getLogCollector(): LogCollector {
  if (!_collector) {
    _collector = new LogCollector();
  }
  return _collector;
}

export function initLogCollector(): LogCollector {
  const collector = getLogCollector();
  collector.hook(getLogger());
  return collector;
}
