import { type ChildProcess, execSync } from 'node:child_process';
import { getDataDir, getLogger } from '@agentx/shared';
import { IS_WINDOWS } from './platform.js';
import type { AgentEventBus } from '../EventBus.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface AgentProcess {
  pid: number;
  command: string;
  sessionId: string;
  scopePath: string;
  cwd: string;
  startTime: number;
  status: 'running' | 'stopping' | 'exited';
  port?: number;
  detached?: boolean;
}

const LOG_TAIL_MAX_CHARS = 4000;

interface InternalProcess extends AgentProcess {
  proc?: ChildProcess | null;
  /** Ring-buffer-ish tail of combined stdout/stderr, capped at `LOG_TAIL_MAX_CHARS`. */
  logTail?: string;
  /** True once we've deliberately asked this process to stop via `kill()` — used to avoid
   *  reporting a supervisor-initiated shutdown as an unexpected "crash". */
  stoppedByUs?: boolean;
}

const logger = getLogger();

/**
 * Tracks long-running child processes started by Agent-X tools — the basis for the
 * "Process Supervisor" described in docs/engineering-crew/DESIGN.md Section 4.6.
 *
 * The registry keeps the live `ChildProcess` handle so it can remove entries automatically
 * when a process exits, exposes a stable list that the web UI can poll to show running
 * apps/ports, captures a bounded tail of the process's own output for crash diagnostics, and
 * proactively notifies the owning session (via a registered `AgentEventBus`, mirroring
 * `BackgroundTaskEventPublisher`'s per-session bus registration) when a process dies —
 * instead of only reporting status the next time the user happens to ask.
 */
export class AgentProcessRegistry {
  private processes = new Map<number, InternalProcess>();
  private buses = new Map<string, AgentEventBus>();
  private persistPath: string | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    this.load();
  }

  /** Persist current running processes to disk so they survive renderer reloads / app restarts. */
  private persist(): void {
    if (!this.persistPath) return;
    try {
      const alive = this.filterAlive([...this.processes.values()]);
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(alive, null, 2));
    } catch (err) {
      logger.debug('AGENT_PROCESS_REGISTRY', `Failed to persist process list: ${(err as Error).message}`);
    }
  }

  /** Rehydrate running processes from disk and verify each PID is still alive. */
  load(): void {
    if (!this.persistPath) return;
    try {
      if (!existsSync(this.persistPath)) return;
      const raw = readFileSync(this.persistPath, 'utf-8');
      const parsed = JSON.parse(raw) as AgentProcess[];
      for (const p of parsed) {
        if (!p.pid || typeof p.pid !== 'number') continue;
        if (this.processes.has(p.pid)) continue;

        // Skip records whose process has already exited.
        if (p.status === 'exited') continue;

        // Best-effort liveness probe.
        let alive = false;
        if (IS_WINDOWS) {
          try {
            execSync(`tasklist /FI "PID eq ${p.pid}" /FO CSV /NH`, { timeout: 2000 });
            alive = true;
          } catch { /* not found */ }
        } else {
          try {
            process.kill(p.pid, 0);
            alive = true;
          } catch { /* not found */ }
        }

        if (!alive) continue;

        const record: InternalProcess = { ...p, status: 'running' };
        // If the process is a shell group leader, recheck its port from command.
        if (!record.port && record.command) {
          record.port = this.guessPort(record.command);
        }
        this.processes.set(p.pid, record);
      }
    } catch (err) {
      logger.debug('AGENT_PROCESS_REGISTRY', `Failed to load process list: ${(err as Error).message}`);
    }
  }

  /** Register the session's event bus so process lifecycle events can be pushed proactively. */
  registerSessionEventBus(sessionId: string, eventBus: AgentEventBus): void {
    this.buses.set(sessionId, eventBus);
  }

  unregisterSessionEventBus(sessionId: string): void {
    this.buses.delete(sessionId);
  }

  /** Append output to a process's bounded log tail (used by tools that pipe stdio). */
  appendLog(pid: number, chunk: string): void {
    const p = this.processes.get(pid);
    if (!p || !chunk) return;
    const combined = (p.logTail ?? '') + chunk;
    p.logTail = combined.length > LOG_TAIL_MAX_CHARS ? combined.slice(-LOG_TAIL_MAX_CHARS) : combined;
  }

  track(
    proc: ChildProcess,
    meta: Omit<AgentProcess, 'pid' | 'startTime' | 'status'> & { detached?: boolean },
  ): void {
    const pid = proc.pid;
    if (!pid || pid <= 0) return;

    const existing = this.processes.get(pid);
    if (existing) {
      // Update metadata but keep the earlier start time / handle.
      this.processes.set(pid, { ...existing, ...meta });
      this.persist();
      return;
    }

    const port = meta.port ?? this.guessPort(meta.command);
    const record: InternalProcess = {
      ...meta,
      pid,
      startTime: Date.now(),
      status: 'running',
      port,
      proc,
    };

    this.processes.set(pid, record);
    this.persist();

    proc.on('close', (code) => {
      logger.debug('AGENT_PROCESS_CLOSE', `PID ${pid} exited with code ${code ?? 'unknown'}`);
      const p = this.processes.get(pid);
      this.notifyProcessDied(p ?? record, code);
      this.processes.delete(pid);
      this.persist();
    });

    proc.on('error', (err) => {
      logger.debug('AGENT_PROCESS_ERROR', `PID ${pid} error: ${err.message}`);
      const p = this.processes.get(pid);
      this.notifyProcessDied(p ?? record, null);
      this.processes.delete(pid);
      this.persist();
    });
  }

  /**
   * Proactively push a `process_status_changed` event to the owning session so the user
   * finds out a long-running process died without having to ask "is it still running?".
   * A deliberate shutdown via `kill()` is still reported (status `exited`), just without the
   * "crashed" framing a nonzero/unexpected exit gets.
   */
  private notifyProcessDied(p: InternalProcess, code: number | null): void {
    const bus = this.buses.get(p.sessionId);
    if (!bus) return;
    const crashed = !p.stoppedByUs && code !== 0;
    bus.emit({
      type: 'process_status_changed',
      pid: p.pid,
      command: p.command,
      status: crashed ? 'crashed' : 'exited',
      exitCode: code,
      port: p.port,
      startedAgo: Date.now() - p.startTime,
      logTail: p.logTail,
    });
  }

  update(pid: number, patch: Partial<AgentProcess>): boolean {
    const p = this.processes.get(pid);
    if (!p) return false;
    this.processes.set(pid, { ...p, ...patch });
    this.persist();
    return true;
  }

  untrack(pid: number): void {
    this.processes.delete(pid);
    this.persist();
  }

  isTracked(pid: number): boolean {
    return this.processes.has(pid);
  }

  get(pid: number): AgentProcess | undefined {
    const p = this.processes.get(pid);
    return p ? this.toPublic(p) : undefined;
  }

  /** Bounded tail of a still-running (or just-exited) process's own stdout/stderr, if captured. */
  getLogTail(pid: number): string | undefined {
    return this.processes.get(pid)?.logTail;
  }

  getAll(): AgentProcess[] {
    return this.filterAlive([...this.processes.values()]);
  }

  getBySession(sessionId: string): AgentProcess[] {
    return this.filterAlive([...this.processes.values()].filter((p) => p.sessionId === sessionId));
  }

  kill(pid: number, signal: string = 'SIGTERM'): boolean {
    const p = this.processes.get(pid);
    if (!p) return false;

    try {
      if (IS_WINDOWS) {
        // Kill the entire process tree so shell grandchildren are also stopped.
        const treeFlag = p.detached ? '/T' : '';
        try { execSync(`taskkill ${treeFlag} /F /PID ${pid} 2>nul`, { timeout: 5000 }); } catch { /* ignore */ }
      } else if (p.detached) {
        // Detached background processes are their own group leaders: kill the whole group.
        try {
          process.kill(-pid, signal as NodeJS.Signals);
        } catch {
          process.kill(pid, signal as NodeJS.Signals);
        }
      } else if (p.proc && !p.proc.killed) {
        // Streaming / foreground processes share our group; only signal the single handle.
        p.proc.kill(signal as NodeJS.Signals);
      } else {
        process.kill(pid, signal as NodeJS.Signals);
      }

      this.processes.set(pid, { ...p, status: 'stopping', stoppedByUs: true });
      this.persist();

      // Safety net: force-remove if the close event never arrives.
      setTimeout(() => {
        if (this.processes.has(pid)) {
          this.processes.delete(pid);
          this.persist();
        }
      }, 8000);

      return true;
    } catch (e) {
      this.processes.delete(pid);
      this.persist();
      return false;
    }
  }

  private filterAlive(records: InternalProcess[]): AgentProcess[] {
    const alive: AgentProcess[] = [];
    let changed = false;
    for (const p of records) {
      if (p.status === 'exited') {
        this.processes.delete(p.pid);
        changed = true;
        continue;
      }

      if (p.proc) {
        // If the ChildProcess handle has already emitted exit, remove it.
        if ((p.proc as { exitCode?: number | null }).exitCode !== null || p.proc.killed) {
          this.processes.delete(p.pid);
          changed = true;
          continue;
        }
      }

      // Best-effort liveness probe (Unix-only; harmless on Windows).
      if (!IS_WINDOWS) {
        try {
          process.kill(p.pid, 0);
        } catch {
          this.processes.delete(p.pid);
          changed = true;
          continue;
        }
      }

      alive.push(this.toPublic(p));
    }
    if (changed) this.persist();
    return alive;
  }

  private toPublic(p: InternalProcess): AgentProcess {
    const { proc, ...rest } = p;
    return rest;
  }

  private guessPort(command: string): number | undefined {
    const patterns = [
      // --port 8080, -p 8080, --port=8080, -p8080
      /(?:^|\s)(?:--port|-p)\s*[=:\s]?\s*(\d{2,5})(?:\D|$)/i,
      // ENV port assignments: SERVER_PORT=8080, PORT=3000, APP_PORT=5000
      /(?:^|\s|\b)(?:SERVER_PORT|APP_PORT|HTTP_PORT|LISTEN_PORT|HOST_PORT|PORT)\s*=\s*(\d{2,5})(?:\D|$)/i,
      // Spring Boot: -Dserver.port=8080
      /(?:^|\s)(?:-Dserver\.port|--server\.port)\s*[=:\s]?\s*(\d{2,5})(?:\D|$)/i,
      // python -m http.server 8080
      /python\s+-m\s+http\.server\s+(\d{2,5})(?:\D|$)/i,
      // npm/node bin with -p or --port (shorthand -p8080)
      /(?:^|\s)-p\s*(\d{2,5})(?:\D|$)/i,
      // uvicorn/gunicorn/flask: --bind :8000, --port=8000, -p 8000
      /(?:^|\s)(?:--bind|-b)\s+[^\s:]*:(\d{2,5})(?:\D|$)/i,
      // fastapi run --port 8000, gradio --server-port 7860
      /(?:^|\s)(?:--server-port)\s*[=:\s]?\s*(\d{2,5})(?:\D|$)/i,
    ];

    for (const re of patterns) {
      const m = command.match(re);
      if (m) {
        const port = Number(m[1]);
        if (port > 0 && port <= 65535) return port;
      }
    }

    // Fallback: any 4-5 digit number in the typical port range.
    const matches = command.match(/(?:\D|^)(\d{4,5})(?:\D|$)/g);
    if (matches) {
      for (const match of matches) {
        const n = Number(match.replace(/\D/g, ''));
        if (n >= 1024 && n <= 65535) return n;
      }
    }

    return undefined;
  }
}

let registry: AgentProcessRegistry | undefined;

export function getAgentProcessRegistry(): AgentProcessRegistry {
  if (!registry) {
    registry = new AgentProcessRegistry(join(getDataDir(), 'running-processes.json'));
  }
  return registry;
}
