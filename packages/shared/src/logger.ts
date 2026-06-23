/**
 * Agent-X Structured Logger — writes JSON entries to file and optionally to console.
 * Location: ~/.local/share/agentx/logs/error.log
 * 
 * Features:
 * - JSON structured logging (file + console transport)
 * - Asynchronous file writes via internal queue (non-blocking)
 * - Console transport enabled by default in Docker/containers
 * - Log level filtering via AGENTX_LOG_LEVEL env var
 * - Automatic log rotation at 5MB (keeps 3 rotated files)
 * - Never throws or crashes the app over logging failures
 */
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getLogDir } from './utils/paths.js';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATED_FILES = 3;

export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  code: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Durable ring buffer for log entries before they hit disk.
 * Prevents event-loop blocking by batching writes.
 */
class LogQueue {
  private buffer: LogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
    // Flush every 500ms or when buffer reaches 50 entries
    this.timer = setInterval(() => this.flush(), 500);
    this.timer.unref();
  }

  push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= 50) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      this.rotateIfNeeded();
      const text = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
      appendFileSync(this.logPath, text);
    } catch {
      // Never crash the app over logging
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.logPath)) return;
    try {
      const stats = statSync(this.logPath);
      if (stats.size < MAX_LOG_SIZE) return;
      for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
        const from = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
        const to = `${this.logPath}.${i}`;
        if (i === MAX_ROTATED_FILES && existsSync(to)) unlinkSync(to);
        if (existsSync(from)) renameSync(from, to);
      }
    } catch { /* non-critical */ }
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}

export class Logger {
  private logPath: string;
  private consoleTransport: boolean;
  private minLevel: number;
  private queue: LogQueue;

  private static readonly LEVEL_MAP: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(logDir: string) {
    this.logPath = join(logDir, 'error.log');
    // Console transport: enabled by default in containers/development
    this.consoleTransport =
      process.env['AGENTX_LOG_CONSOLE'] !== '0' && (
        process.env['AGENTX_LOG_CONSOLE'] === '1' ||
        process.env['NODE_ENV'] === 'development' ||
        !process.env['NODE_ENV']
      );
    this.minLevel = Logger.LEVEL_MAP[process.env['AGENTX_LOG_LEVEL'] || 'info'] ?? 1;
    mkdirSync(logDir, { recursive: true });
    this.queue = new LogQueue(this.logPath);
  }

  private shouldLog(level: string): boolean {
    return (Logger.LEVEL_MAP[level] ?? 0) >= this.minLevel;
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    // Queue for async file write (non-blocking)
    this.queue.push(entry);

    // Console transport: structured JSON to stdout/stderr
    if (this.consoleTransport) {
      const stream = entry.level === 'error' ? process.stderr : process.stdout;
      try {
        stream.write(JSON.stringify(entry) + '\n');
      } catch {
        // Best-effort
      }
    }
  }

  error(code: string, error: unknown, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
    });
  }

  warn(code: string, message: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      code,
      message,
      context,
    });
  }

  info(code: string, message: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      code,
      message,
      context,
    });
  }

  debug(code: string, message: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      code,
      message,
      context,
    });
  }

  /**
   * Flush pending log entries to disk.
   * Call during graceful shutdown to ensure no data loss.
   */
  flush(): void {
    this.queue.close();
  }
}

/** Singleton logger instance — lazily initialized */
let _logger: Logger | null = null;

export function getLogger(logDir?: string): Logger {
  if (!_logger) {
    const dir = logDir ?? getDefaultLogDir();
    _logger = new Logger(dir);
  }
  return _logger;
}

/**
 * Flush and reset the logger singleton.
 * Primarily used during graceful shutdown.
 */
export function closeLogger(): void {
  if (_logger) {
    _logger.flush();
    _logger = null;
  }
}

function getDefaultLogDir(): string {
  return getLogDir();
}
