import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEBUG_DIR = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || '/tmp', '.local', 'share'),
  'agentx',
  'debug-logs',
);

interface DebugLogEntry {
  timestamp: string;
  provider: string;
  endpoint: string;
  status: number;
  contentType: string;
  responseBody: string;
  error: string;
  context: string;
}

function ensureDir(): void {
  if (!existsSync(DEBUG_DIR)) {
    try { mkdirSync(DEBUG_DIR, { recursive: true }); } catch { /* best effort */ }
  }
}

export function writeDebugLog(entry: Omit<DebugLogEntry, 'timestamp'>): void {
  try {
    ensureDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}__${entry.provider}__${entry.context.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.json`;
    writeFileSync(
      join(DEBUG_DIR, filename),
      JSON.stringify({ timestamp: new Date().toISOString(), ...entry }, null, 2),
    );
  } catch { /* best effort — debug logging must never crash the app */ }
}

export async function captureResponse(
  provider: string,
  endpoint: string,
  context: string,
  response: Response,
): Promise<{ body?: string; json?: Record<string, unknown> }> {
  try {
    const cloned = response.clone();
    const text = await cloned.text().catch(() => '<unreadable>');
    let parsed: Record<string, unknown> | undefined;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }

    writeDebugLog({
      provider,
      endpoint,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      responseBody: text.slice(0, 10000),
      error: 'unexpected-format',
      context,
    });

    return { body: text, json: parsed };
  } catch {
    return {};
  }
}

export function logParseError(
  provider: string,
  endpoint: string,
  context: string,
  rawBody: string,
  errorMsg: string,
): void {
  writeDebugLog({
    provider,
    endpoint,
    status: 0,
    contentType: '',
    responseBody: rawBody.slice(0, 10000),
    error: errorMsg,
    context,
  });
}
