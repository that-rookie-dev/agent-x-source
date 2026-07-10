/**
 * In-process bridge so the web API can start/stop embedded Postgres owned by AgentRuntime
 * (desktop main process and server daemon both load web-api in the same Node process).
 *
 * AgentRuntime sets `globalThis.__agentxEmbeddedPgController` *before* importing web-api,
 * because web-api auto-listens on import and the wizard may call provision immediately.
 */

export type EmbeddedPostgresLogFn = (line: string) => void;

export interface EmbeddedPostgresController {
  /** Start (or return existing) embedded Postgres; streams progress via onLog. */
  start: (onLog?: EmbeddedPostgresLogFn) => Promise<string>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentxEmbeddedPgController: EmbeddedPostgresController | undefined;
}

let controller: EmbeddedPostgresController | null = null;

export function registerEmbeddedPostgresController(next: EmbeddedPostgresController | null): void {
  controller = next;
  if (next) {
    globalThis.__agentxEmbeddedPgController = next;
  } else {
    delete globalThis.__agentxEmbeddedPgController;
  }
}

export function getEmbeddedPostgresController(): EmbeddedPostgresController | null {
  return controller ?? globalThis.__agentxEmbeddedPgController ?? null;
}

export async function startEmbeddedPostgresViaBridge(onLog?: EmbeddedPostgresLogFn): Promise<string> {
  const active = getEmbeddedPostgresController();
  if (!active) {
    throw new Error(
      'Embedded PostgreSQL controller is not available. Restart Agent-X (desktop or agentx start) and try again.',
    );
  }
  return active.start(onLog);
}
