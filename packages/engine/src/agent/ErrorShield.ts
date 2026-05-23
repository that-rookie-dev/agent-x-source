import { getLogDir } from '../config/paths.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export class ErrorShield {
  private logPath: string;

  constructor() {
    const logDir = getLogDir();
    mkdirSync(logDir, { recursive: true });
    this.logPath = join(logDir, 'errors.jsonl');
  }

  wrap<T>(operation: () => T, fallback: T): T {
    try {
      return operation();
    } catch (error) {
      this.logError(error);
      return fallback;
    }
  }

  async wrapAsync<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logError(error);
      return fallback;
    }
  }

  logError(error: unknown): void {
    const entry = {
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch {
      // If we can't even log, silently swallow
    }
  }
}
