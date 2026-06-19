/**
 * Agent-X File Logger — writes structured error logs with rotation.
 * Location: ~/.local/share/agentx/logs/error.log
 */
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
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

export class Logger {
  private logPath: string;

  constructor(logDir: string) {
    this.logPath = join(logDir, 'error.log');
    mkdirSync(logDir, { recursive: true });
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

  private write(entry: LogEntry): void {
    try {
      this.rotateIfNeeded();
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch {
      // If we can't log, silently fail — never crash the app over logging
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.logPath)) return;

    try {
      const stats = statSync(this.logPath);
      if (stats.size < MAX_LOG_SIZE) return;

      // Rotate: error.log.3 → delete, error.log.2 → .3, error.log.1 → .2, error.log → .1
      for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
        const from = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
        const to = `${this.logPath}.${i}`;
        if (i === MAX_ROTATED_FILES && existsSync(to)) {
          unlinkSync(to);
        }
        if (existsSync(from)) {
          renameSync(from, to);
        }
      }
    } catch {
      // Rotation failure is non-critical
    }
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

function getDefaultLogDir(): string {
  return getLogDir();
}
