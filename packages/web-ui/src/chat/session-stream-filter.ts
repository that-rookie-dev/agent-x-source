import type { TelemetryEvent } from '../api';

/** Events that are not tied to a single chat session (safe to show regardless of open session). */
const SESSION_AGNOSTIC_EVENT_TYPES = new Set([
  'crew_suggestion',
  'crew_suggestion_required',
  'notification_created',
  'markdown_created',
  'automation_run_triggered',
  'automation_run_preparing',
  'automation_run_started',
  'automation_run_ended',
]);

export function resolveTelemetryEventSessionId(ev: TelemetryEvent): string | undefined {
  const topLevel = ev.sessionId as string | undefined;
  if (topLevel) return topLevel;
  const messageSessionId = (ev as { message?: { sessionId?: string } }).message?.sessionId;
  if (messageSessionId) return messageSessionId;
  return undefined;
}

/** True when a streamed telemetry event should update the currently open chat session. */
export function eventBelongsToViewSession(ev: TelemetryEvent, viewSessionId: string | null | undefined): boolean {
  if (!viewSessionId) return false;
  if (SESSION_AGNOSTIC_EVENT_TYPES.has(ev.type)) return true;

  const eventSessionId = resolveTelemetryEventSessionId(ev);
  if (eventSessionId === viewSessionId) return true;

  const parentSessionId = (ev as { parentSessionId?: string }).parentSessionId;
  if (parentSessionId === viewSessionId) return true;

  return false;
}
