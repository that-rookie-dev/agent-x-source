import { randomUUID } from 'node:crypto';

/**
 * Application IDs may be:
 * - Raw UUIDs (sessions, crews, tool executions)
 * - Prefixed pseudo-IDs (sub-agents, messages, files)
 *
 * All IDs are stored as TEXT so they are portable across PostgreSQL and any user-provided SQLite files.
 */
export const PSEUDO_ID_PREFIXES = [
  'sub-',       // SmartSubAgent child sessions: sub-{uuid}
  'sub_',       // generateId('sub')
  'msg_',       // generateMessageId()
  'file_',      // upload file ids
  'crew-worker-', // crew worker telemetry (not session PK)
  '__channel__',  // channel bridge session
  'automation:',  // internal automation run log (one per task)
  'voice:',       // crew private-call transcript (sibling of text chat)
] as const;

/** True when id is a standard UUID (no prefix). */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** True when id uses a known application prefix (sub-agent, message, etc.). */
export function isPseudoId(id: string): boolean {
  if (id === '__channel__' || id.startsWith('__channel__:')) return true;
  return PSEUDO_ID_PREFIXES.some((p) => p !== '__channel__' && id.startsWith(p));
}

export function generateId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function generateSessionId(): string {
  return randomUUID();
}

export function generateMessageId(): string {
  return generateId('msg');
}

/** Sub-agent / child session pseudo-id (matches SmartSubAgent convention). */
export function generateSubSessionId(): string {
  return `sub-${randomUUID()}`;
}
