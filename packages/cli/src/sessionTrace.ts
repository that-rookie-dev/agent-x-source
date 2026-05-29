import { writeFileSync } from 'node:fs';
import { format } from 'node:util';
import { platform, arch } from 'node:os';

type TraceEvent = {
  ts: number;
  level: 'log' | 'error' | 'trace' | 'uncaughtException' | 'unhandledRejection';
  message: string;
  args?: unknown[];
  stack?: string | undefined;
};

let BUFFER: TraceEvent[] = [];
let MAX_EVENTS = 50;
let FILE_PATH = '/tmp/agentx-last-session.json';
let startedAt = new Date().toISOString();
let inited = false;

function writeSnapshot(): void {
  try {
    const payload = {
      startedAt,
      pid: process.pid,
      node: process.version,
      platform: `${platform()}/${arch()}`,
      events: BUFFER,
    };
    writeFileSync(FILE_PATH, JSON.stringify(payload, null, 2));
  } catch {
    // non-fatal
  }
}

function pushEvent(ev: TraceEvent): void {
  BUFFER.push(ev);
  if (BUFFER.length > MAX_EVENTS) BUFFER = BUFFER.slice(BUFFER.length - MAX_EVENTS);
  writeSnapshot();
}

export function initSessionTrace(opts?: { path?: string; maxEvents?: number }): void {
  if (inited) return;
  inited = true;
  if (opts?.path) FILE_PATH = opts.path;
  if (opts?.maxEvents) MAX_EVENTS = opts.maxEvents;
  startedAt = new Date().toISOString();
  BUFFER = [];
  // Overwrite file for last-session semantics
  writeSnapshot();

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    try {
      pushEvent({ ts: Date.now(), level: 'log', message: format(...(args as any)), args });
    } catch {
      /* ignore */
    }
    origLog(...args);
  };

  console.error = (...args: unknown[]) => {
    try {
      const msg = format(...(args as any));
      const stack = (args[0] instanceof Error && args[0].stack) ? (args[0] as Error).stack : undefined;
      pushEvent({ ts: Date.now(), level: 'error', message: msg, args, stack });
    } catch {
      /* ignore */
    }
    origError(...args);
  };

  process.on('uncaughtException', (err: Error) => {
    try {
      pushEvent({ ts: Date.now(), level: 'uncaughtException', message: String(err.message), stack: err.stack });
    } catch { /* ignore */ }
    writeSnapshot();
  });

  process.on('unhandledRejection', (reason) => {
    try {
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      pushEvent({ ts: Date.now(), level: 'unhandledRejection', message: msg, stack });
    } catch { /* ignore */ }
    writeSnapshot();
  });
}

export function trace(msg: string, meta?: unknown): void {
  try {
    pushEvent({ ts: Date.now(), level: 'trace', message: msg, args: meta === undefined ? undefined : [meta] });
  } catch { /* ignore */ }
}

export function clearSessionTrace(): void {
  try {
    BUFFER = [];
    writeSnapshot();
  } catch { /* ignore */ }
}

export function getTraceFilePath(): string {
  return FILE_PATH;
}
