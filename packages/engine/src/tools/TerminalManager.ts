/**
 * TerminalManager — manages PTY-backed persistent terminal sessions for the
 * Engineering Crew. Each session is a long-lived pseudo-terminal that the agent
 * can start a command in, read streamed output from, send input to, and kill.
 *
 * This is the core primitive that enables live debugging:
 *   - Start `mvn spring-boot:run` in a terminal
 *   - Read output to see if it started or crashed
 *   - Send Ctrl-C to stop it
 *   - Start `curl localhost:8080/api/v1/generate` in another terminal to test
 *
 * Inspired by Devin's built-in terminal model.
 */
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { generateId, getLogger } from '@agentx/shared';
import { getShellCommand } from './platform.js';

type PtyModule = typeof import('@homebridge/node-pty-prebuilt-multiarch');
type PtyProcess = ReturnType<PtyModule['spawn']>;

/** Load only when a PTY is spawned so a missing native package cannot block app startup. */
function loadPty(): PtyModule {
  const require = createRequire(import.meta.url);
  return require('@homebridge/node-pty-prebuilt-multiarch') as PtyModule;
}

export interface TerminalSessionOptions {
  /** Command to execute (e.g. "mvn spring-boot:run"). */
  command: string;
  /** Working directory. */
  cwd: string;
  /** Session ID that owns this terminal. */
  sessionId: string;
  /** Environment variables. */
  env?: Record<string, string>;
  /** Initial columns/rows for the PTY. */
  cols?: number;
  rows?: number;
  /** Optional label for UI display. */
  label?: string;
}

export interface TerminalOutputChunk {
  /** Monotonic offset from the start of the session. */
  offset: number;
  /** The raw terminal output bytes (UTF-8 string). */
  data: string;
}

export interface TerminalSessionInfo {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  label: string;
  pid: number;
  alive: boolean;
  exitCode: number | null;
  createdAt: number;
  /** Total bytes of output produced so far. */
  outputLength: number;
  /** Last N lines of output (for quick inspection). */
  tail: string;
}

class TerminalSession {
  readonly id: string;
  readonly sessionId: string;
  readonly command: string;
  readonly cwd: string;
  readonly label: string;
  readonly createdAt: number;
  readonly pid: number;

  private readonly ptyProcess: PtyProcess;
  private output = '';
  private alive = true;
  private exitCode: number | null = null;
  private readonly emitter = new EventEmitter();
  private tailLines: string[] = [];
  private static readonly MAX_TAIL_LINES = 200;

  constructor(opts: TerminalSessionOptions) {
    this.id = `term-${generateId()}`;
    this.sessionId = opts.sessionId;
    this.command = opts.command;
    this.cwd = opts.cwd;
    this.label = opts.label ?? opts.command.slice(0, 60);
    this.createdAt = Date.now();

    const env: Record<string, string> = { TERM: 'xterm-256color' };
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    if (opts.env) Object.assign(env, opts.env);

    // Spawn through the platform shell so the command string is parsed
    // (pipes, &&, redirects) and Windows does not try to exec /bin/sh.
    const shell = getShellCommand(opts.command);
    this.ptyProcess = loadPty().spawn(shell.cmd, shell.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd,
      env,
    });

    this.pid = this.ptyProcess.pid;

    const handleExit = (exitCode: number): void => {
      if (!this.alive && this.exitCode !== null) return;
      this.alive = false;
      this.exitCode = exitCode;
      this.emitter.emit('exit', { exitCode, pid: this.pid });
    };

    this.ptyProcess.onData((data: string) => {
      this.output += data;
      this.emitter.emit('data', { offset: this.output.length - data.length, data } as TerminalOutputChunk);

      // Maintain a rolling tail buffer
      const lines = data.split('\n');
      for (const line of lines) {
        // Strip ANSI escape sequences for the tail preview
        // eslint-disable-next-line no-control-regex -- strip ANSI CSI and OSC sequences from tail preview
        const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
        if (clean.trim()) {
          this.tailLines.push(clean);
          if (this.tailLines.length > TerminalSession.MAX_TAIL_LINES) {
            this.tailLines.shift();
          }
        }
      }
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      handleExit(exitCode);
    });

    // Fast commands (echo, true) can exit before onExit is subscribed.
    setImmediate(() => {
      try {
        process.kill(this.pid, 0);
      } catch {
        handleExit(this.exitCode ?? 0);
      }
    });
  }

  /** Send input to the terminal's stdin. */
  sendInput(text: string): void {
    if (!this.alive) throw new Error(`Terminal ${this.id} is not alive`);
    this.ptyProcess.write(text);
  }

  /** Resize the terminal. */
  resize(cols: number, rows: number): void {
    if (this.alive) {
      this.ptyProcess.resize(cols, rows);
    }
  }

  /** Get output since a given byte offset. */
  getOutputSince(offset: number): { offset: number; data: string; totalLength: number } {
    const data = offset < this.output.length ? this.output.slice(offset) : '';
    return { offset, data, totalLength: this.output.length };
  }

  /** Get the last N lines of output (ANSI-stripped). */
  getTail(maxLines = 50): string {
    return this.tailLines.slice(-maxLines).join('\n');
  }

  /** Get full output (truncated to maxChars). */
  getFullOutput(maxChars = 100_000): string {
    if (this.output.length <= maxChars) return this.output;
    return this.output.slice(-maxChars);
  }

  isAlive(): boolean {
    return this.alive;
  }

  getExitCode(): number | null {
    return this.exitCode;
  }

  kill(): void {
    if (this.alive) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Process may have already exited
      }
    }
  }

  onData(listener: (chunk: TerminalOutputChunk) => void): () => void {
    this.emitter.on('data', listener);
    return () => this.emitter.off('data', listener);
  }

  onExit(listener: (info: { exitCode: number; pid: number }) => void): () => void {
    this.emitter.on('exit', listener);
    return () => this.emitter.off('exit', listener);
  }

  toInfo(): TerminalSessionInfo {
    return {
      id: this.id,
      sessionId: this.sessionId,
      command: this.command,
      cwd: this.cwd,
      label: this.label,
      pid: this.pid,
      alive: this.alive,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      outputLength: this.output.length,
      tail: this.getTail(20),
    };
  }
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private sessionBySessionId = new Map<string, Set<string>>();
  private static instance: TerminalManager | null = null;

  static getInstance(): TerminalManager {
    if (!TerminalManager.instance) {
      TerminalManager.instance = new TerminalManager();
    }
    return TerminalManager.instance;
  }

  /** Start a new terminal session. */
  start(opts: TerminalSessionOptions): TerminalSession {
    const session = new TerminalSession(opts);
    this.sessions.set(session.id, session);

    let set = this.sessionBySessionId.get(opts.sessionId);
    if (!set) {
      set = new Set();
      this.sessionBySessionId.set(opts.sessionId, set);
    }
    set.add(session.id);

    getLogger().info('TERMINAL', `Terminal ${session.id} started: ${opts.command} (PID ${session.pid})`);

    // Auto-cleanup on exit
    session.onExit(() => {
      getLogger().info('TERMINAL', `Terminal ${session.id} exited (code ${session.getExitCode()})`);
    });

    return session;
  }

  /** Get a terminal session by ID. */
  get(id: string): TerminalSession | null {
    return this.sessions.get(id) ?? null;
  }

  /** List all terminals for a given session ID. */
  listBySession(sessionId: string): TerminalSessionInfo[] {
    const ids = this.sessionBySessionId.get(sessionId);
    if (!ids) return [];
    const result: TerminalSessionInfo[] = [];
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (s) result.push(s.toInfo());
    }
    return result;
  }

  /** Kill a terminal session. */
  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.kill();
    return true;
  }

  /** Kill all terminals for a session. */
  killBySession(sessionId: string): number {
    const ids = this.sessionBySessionId.get(sessionId);
    if (!ids) return 0;
    let count = 0;
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (s) {
        s.kill();
        count++;
      }
    }
    return count;
  }

  /** Remove dead sessions (garbage collection). */
  cleanup(): number {
    let removed = 0;
    for (const [id, s] of this.sessions) {
      if (!s.isAlive() && s.getExitCode() !== null) {
        // Keep dead sessions around for a bit so the agent can read final output.
        // Remove only if it's been dead for > 5 minutes.
        if (Date.now() - s.createdAt > 5 * 60_000) {
          this.sessions.delete(id);
          const set = this.sessionBySessionId.get(s.sessionId);
          set?.delete(id);
          removed++;
        }
      }
    }
    return removed;
  }
}
