import type { TelemetryEvent } from '../api';

/** Events that should update the global AppContext event log / notifications. */
const GLOBAL_TELEMETRY_EVENT_TYPES = new Set([
  'notification_created',
  'markdown_created',
  'automation_run_triggered',
  'automation_run_preparing',
  'automation_run_started',
  'automation_run_ended',
  'crew_suggestion',
  'crew_suggestion_required',
  'permission_required',
  'permission_batch_required',
]);

/** High-frequency chat stream events — handled by ChatPanel only. */
const CHAT_HOT_EVENT_TYPES = new Set([
  'stream_chunk',
  'stream_delta',
  'message_chunk',
  'tool_executing',
  'tool_output',
  'tool_complete',
  'reasoning_delta',
  'thinking_delta',
  'reasoning_end',
  'thinking_end',
  'token_usage',
  'turn_heartbeat',
  'turn_state',
  'loading_step_update',
  'loading_start',
  'loading_end',
  'message_received',
  'message_sent',
  'agent_thinking',
  'step_indicator',
  'operation_file_edited',
  'operation_file_created',
  'operation_file_read',
  'operation_search_glob',
  'operation_search_grep',
  'operation_list_files',
  'operation_command_executed',
  'subagent_event',
  'background_task_complete',
  'todo_update',
  'crew_worker_progress',
  'crew_worker_spawned',
  'crew_worker_complete',
  'crew_inter_message',
  'crew_mission_start',
  'crew_mission_complete',
  'crew_mission_retry',
  'child_session_started',
  'agent_spawned',
  'decision_made',
  'provider_error',
  'step_cap_reached',
  'task_aborted',
  'command_action',
  'compaction_complete',
]);

export function isGlobalTelemetryEvent(ev: TelemetryEvent): boolean {
  return GLOBAL_TELEMETRY_EVENT_TYPES.has(ev.type);
}

export function isChatHotTelemetryEvent(ev: TelemetryEvent): boolean {
  return CHAT_HOT_EVENT_TYPES.has(ev.type);
}

export function shouldAppendToAppContextEvents(ev: TelemetryEvent): boolean {
  return isGlobalTelemetryEvent(ev);
}
