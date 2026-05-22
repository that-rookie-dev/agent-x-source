import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir } from '../config/paths.js';

interface CrashState {
  sessionId: string;
  timestamp: string;
  provider: string;
  model: string;
  messageCount: number;
  lastUserMessage?: string;
  error?: string;
}

/**
 * Handles graceful error recovery and crash state persistence.
 * On unhandled crash, saves session state to a recovery file.
 * On next startup, offers to restore the session.
 */
export class CrashRecovery {
  private recoveryPath: string;
  private registered = false;

  constructor() {
    const cacheDir = getCacheDir();
    mkdirSync(cacheDir, { recursive: true });
    this.recoveryPath = join(cacheDir, 'crash-recovery.json');
  }

  /**
   * Register process-level error handlers for crash recovery.
   */
  register(getState: () => CrashState): void {
    if (this.registered) return;
    this.registered = true;

    const saveOnCrash = (reason: string) => {
      try {
        const state = getState();
        state.error = reason;
        writeFileSync(this.recoveryPath, JSON.stringify(state, null, 2));
      } catch {
        // Best effort — don't throw in crash handler
      }
    };

    process.on('uncaughtException', (err) => {
      saveOnCrash(`Uncaught exception: ${err.message}`);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      saveOnCrash(`Unhandled rejection: ${msg}`);
      // Don't exit for unhandled rejections — log and continue
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      this.clearRecovery();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.clearRecovery();
      process.exit(0);
    });
  }

  /**
   * Check if there's a recoverable crash state from a previous session.
   */
  hasRecoveryState(): boolean {
    return existsSync(this.recoveryPath);
  }

  /**
   * Load the recovery state.
   */
  getRecoveryState(): CrashState | null {
    if (!this.hasRecoveryState()) return null;
    try {
      const data = readFileSync(this.recoveryPath, 'utf-8');
      return JSON.parse(data) as CrashState;
    } catch {
      return null;
    }
  }

  /**
   * Clear the recovery file (called after successful restore or dismiss).
   */
  clearRecovery(): void {
    try {
      if (existsSync(this.recoveryPath)) {
        unlinkSync(this.recoveryPath);
      }
    } catch {
      // Ignore
    }
  }
}
