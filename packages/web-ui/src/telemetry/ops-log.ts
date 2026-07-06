import type { TelemetryEvent } from '../api';

export interface OpsLogEntry {
  id: string;
  ts: number;
  level: 'info' | 'tool' | 'think' | 'ok' | 'err' | 'sys';
  label: string;
  detail?: string;
}

/** Map agent/chat telemetry to compact log lines (voice modal, automation, etc.). */
export function chatAgentTelemetryToLogEntry(ev: TelemetryEvent): OpsLogEntry | null {
  const ts = Date.now();
  const id = `${ev.type}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
  switch (ev.type) {
    case 'loading_start':
      return { id, ts, level: 'think', label: 'AGENT', detail: String((ev as { stage?: string }).stage ?? 'Processing…') };
    case 'loading_end':
      return { id, ts, level: 'info', label: 'TURN', detail: 'Complete' };
    case 'loading_step_update':
      return {
        id, ts, level: 'think',
        label: 'STEP',
        detail: String((ev as { label?: string }).label ?? (ev as { stepId?: string }).stepId ?? ''),
      };
    case 'turn_heartbeat':
      // Heartbeats fire every 2s — omit from mission log to avoid spam.
      return null;
    case 'agent_thinking':
      return {
        id, ts, level: 'think',
        label: 'THINK',
        detail: String((ev as { content?: string }).content ?? '').slice(0, 500),
      };
    case 'tool_executing':
      return {
        id, ts, level: 'tool',
        label: String((ev as { tool?: string }).tool ?? 'tool'),
        detail: String((ev as { message?: string }).message ?? (ev as { description?: string }).description ?? ''),
      };
    case 'tool_complete':
    case 'tool_result':
      return {
        id, ts, level: (ev as { success?: boolean }).success === false ? 'err' : 'tool',
        label: String((ev as { tool?: string }).tool ?? 'tool'),
        detail: String((ev as { output?: string }).output ?? (ev as { result?: { output?: string } }).result?.output ?? '').slice(0, 400),
      };
    case 'tool_output':
      return {
        id, ts, level: 'tool',
        label: `stream ${String((ev as { tool?: string }).tool ?? '')}`,
        detail: String((ev as { output?: string }).output ?? '').slice(0, 300),
      };
    case 'message_received': {
      const msg = (ev as { message?: { role?: string; content?: string } }).message;
      if (msg?.role !== 'assistant') return null;
      return { id, ts, level: 'ok', label: 'REPLY', detail: String(msg.content ?? '').slice(0, 600) };
    }
    case 'operation_file_edited':
    case 'operation_file_created':
    case 'operation_file_read':
    case 'operation_command_executed':
      return {
        id, ts, level: 'tool',
        label: ev.type.replace('operation_', '').replace(/_/g, ' '),
        detail: String((ev as { path?: string }).path ?? (ev as { command?: string }).command ?? '').slice(0, 300),
      };
    case 'provider_error':
      return { id, ts, level: 'err', label: 'ERROR', detail: String((ev as { message?: string }).message ?? '').slice(0, 300) };
    default:
      return null;
  }
}
