import { EventEmitter } from 'node:events';
import type { LogEntry } from '@agentx/shared';
import { getLogger, type Logger } from '@agentx/shared';
import type { SessionLogger } from '../session/SessionLogger.js';

export interface LogCollectorEvent {
  entry: LogEntry;
  index: number;
}

const MAX_BUFFER = 5000;

export class LogCollector extends EventEmitter {
  private buffer: LogEntry[] = [];
  private index = 0;
  private _originalLogger: Logger | null = null;

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

  hook(logger: Logger): void {
    if (this._originalLogger) return;

    // Capture original methods BEFORE replacing them (avoids infinite recursion)
    const origError = logger.error.bind(logger);
    const origWarn = logger.warn.bind(logger);
    const origInfo = logger.info.bind(logger);

    this._originalLogger = logger;

    logger.error = ((code: string, error: unknown, context?: Record<string, unknown>) => {
      origError(code, error, context);
      this.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        code,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context,
      });
    }) as Logger['error'];
    logger.warn = ((code: string, message: string, context?: Record<string, unknown>) => {
      origWarn(code, message, context);
      this.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        code,
        message,
        context,
      });
    }) as Logger['warn'];
    logger.info = ((code: string, message: string, context?: Record<string, unknown>) => {
      origInfo(code, message, context);
      this.push({
        timestamp: new Date().toISOString(),
        level: 'info',
        code,
        message,
        context,
      });
    }) as Logger['info'];
  }

  hookSessionLogger(sessionLogger: SessionLogger): void {
    const originalLog = sessionLogger.log.bind(sessionLogger);
    sessionLogger.log = (entry: Parameters<SessionLogger['log']>[0]) => {
      originalLog(entry);
      const level: LogEntry['level'] =
        entry.type.startsWith('error') ? 'error' :
        entry.type === 'warning' ? 'warn' : 'info';

      const msg = typeof entry.data['message'] === 'string' ? entry.data['message'] as string :
                  typeof entry.data['content'] === 'string' ? (entry.data['content'] as string).slice(0, 500) :
                  JSON.stringify(entry.data).slice(0, 500);

      this.push({
        timestamp: new Date().toISOString(),
        level,
        code: entry.type,
        message: msg.length > 500 ? msg.slice(0, 500) + '...' : msg,
        context: entry.data,
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
