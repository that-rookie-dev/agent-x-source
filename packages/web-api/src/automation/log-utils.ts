import type { AutomationLogLevel } from '@agentx/shared';

export interface PersistedLogInput {
  level: AutomationLogLevel;
  label: string;
  detail?: string | null;
  eventType?: string | null;
  ts?: string;
}

export function telemetryEventToPersistedLog(ev: { type?: string; timestamp?: string; [key: string]: unknown }): PersistedLogInput | null {
  const ts = ev.timestamp ?? new Date().toISOString();
  switch (ev.type) {
    case 'automation_run_triggered':
      return {
        level: 'sys',
        label: 'TRIGGER',
        detail: 'Scheduled time reached',
        eventType: ev.type,
        ts,
      };
    case 'automation_run_preparing':
      return {
        level: 'sys',
        label: 'PREP',
        detail: String(ev.detail ?? 'Preparing worker…'),
        eventType: ev.type,
        ts,
      };
    case 'automation_run_started':
      return {
        level: 'sys',
        label: 'START',
        detail: (ev.title as string) ?? null,
        eventType: ev.type,
        ts,
      };
    case 'automation_run_ended':
      return {
        level: ev.status === 'failed' ? 'err' : 'ok',
        label: 'END',
        detail: (ev.status as string) ?? 'done',
        eventType: ev.type,
        ts,
      };
    case 'loading_start':
      return { level: 'think', label: 'AGENT', detail: 'Processing…', eventType: ev.type, ts };
    case 'loading_end':
      return { level: 'info', label: 'TURN', eventType: ev.type, ts };
    case 'agent_thinking':
      return {
        level: 'think',
        label: 'THINK',
        detail: String(ev.content ?? '').slice(0, 500) || null,
        eventType: ev.type,
        ts,
      };
    case 'tool_executing':
      return {
        level: 'tool',
        label: (ev.tool as string) ?? 'tool',
        detail: (ev.message as string) ?? (ev.description as string) ?? null,
        eventType: ev.type,
        ts,
      };
    case 'tool_complete':
    case 'tool_result':
      return {
        level: ev.success === false ? 'err' : 'tool',
        label: (ev.tool as string) ?? 'tool',
        detail: String(ev.output ?? (ev.result as { output?: string } | undefined)?.output ?? '').slice(0, 400) || null,
        eventType: ev.type,
        ts,
      };
    case 'tool_output':
      return {
        level: 'tool',
        label: `stream ${(ev.tool as string) ?? ''}`.trim(),
        detail: String(ev.output ?? '').slice(0, 300) || null,
        eventType: ev.type,
        ts,
      };
    case 'message_received': {
      const msg = ev.message as { role?: string; content?: string } | undefined;
      if (msg?.role !== 'assistant') return null;
      return {
        level: 'ok',
        label: 'REPORT',
        detail: String(msg.content ?? '').slice(0, 600) || null,
        eventType: ev.type,
        ts,
      };
    }
    default:
      return null;
  }
}

export function automationRunSessionMatchesTask(
  ev: { type?: string; sessionId?: string; automationTaskId?: string; taskId?: string },
  taskId: string,
  sessionId: string,
): boolean {
  if (ev.type === 'automation_run_started' || ev.type === 'automation_run_ended'
    || ev.type === 'automation_run_triggered' || ev.type === 'automation_run_preparing') {
    return ev.taskId === taskId;
  }
  return ev.automationTaskId === taskId || ev.sessionId === sessionId;
}
