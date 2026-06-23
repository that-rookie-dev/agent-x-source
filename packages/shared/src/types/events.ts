import type { Message } from './message.js';
import type { ModelInfo } from './provider.js';
import type { ToolResult } from './tool.js';

export interface ClarificationField {
  key: string;
  label: string;
  placeholder?: string;
}

export interface ClarificationRequestMeta {
  recommended?: string;
  allowChooseAll?: boolean;
  selectionMode?: 'single' | 'multiple';
  fields?: ClarificationField[];
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'awaiting_approval' | 'executing' | 'done' | 'failed' | 'skipped';
  tool?: string;
  targetPath?: string;
}

export interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: string;
}

export type RemediationAction =
  | { type: 'switch_model'; label: string }
  | { type: 'reconfigure_key'; label: string }
  | { type: 'retry'; label: string }
  | { type: 'dismiss'; label: string }
  | { type: 'open_url'; label: string; url: string };

export type EngineEvent =
  | { type: 'message_sent'; message: Message }
  | { type: 'message_received'; message: Message; elapsed: number }
  | { type: 'stream_chunk'; content: string; fullContent: string }
  | { type: 'loading_start'; stage: string; steps?: Array<{ id: string; label: string; status: 'pending' | 'active' | 'completed' }> }
  | { type: 'loading_end' }
  | { type: 'loading_step_update'; stepId: string; label: string; status: 'pending' | 'active' | 'completed' }
  | { type: 'processing_start'; taskDescription: string }
  | { type: 'processing_progress'; stage: string; progress: number }
  | { type: 'processing_complete'; result: FormattedResponse }
  | { type: 'permission_required'; requestId: string; tool: string; path: string; riskLevel: string }
  | { type: 'token_update'; used: number; available: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean; actions?: RemediationAction[] }
  | { type: 'provider_error'; provider: string; model: string; statusCode?: number; message: string; recoverable: boolean; actions?: RemediationAction[] }
  | { type: 'tool_executing'; tool: string; description: string; startTime: number; args?: Record<string, unknown>; callId?: string }
  | { type: 'tool_complete'; tool: string; result: ToolResult; elapsed: number; args?: Record<string, unknown>; callId?: string }
  | { type: 'tool_output'; tool: string; callId: string; output: string; timestamp: number }
  | { type: 'tool_called'; callId: string; tool: string; args: Record<string, unknown>; startTime: number }
  | { type: 'tool_result'; callId: string; tool: string; success: boolean; output: string; elapsed: number; args?: Record<string, unknown>; metadata?: { diff?: string; filePath?: string; oldContent?: string; newContent?: string; error?: string } }
  | { type: 'agent_spawned'; agentId: string; task: string; startTime: number }
  | { type: 'child_session_started'; childSessionId: string; parentSessionId: string; label: string; kind: 'sub_agent' | 'crew_worker' }
  | { type: 'child_session_complete'; childSessionId: string; parentSessionId: string; success: boolean }
  | { type: 'agent_progress'; agentId: string; status: string }
  | { type: 'agent_complete'; agentId: string; summary: string; elapsed: number }
  | { type: 'task_consolidated_time'; totalElapsed: number; breakdown: Array<{ tool: string; elapsed: number }> }
  | { type: 'task_backgrounded'; taskId: string }
  | { type: 'steer_message'; taskId: string; instruction: string }
  | { type: 'reminder_fired'; taskId: string; name: string; message: string }
  | { type: 'background_task_complete'; taskId: string; childSessionId?: string; tokensUsed?: number; elapsedMs?: number; summary: string }
  | { type: 'subagent_result'; taskId: string; childSessionId: string; tokensUsed: number; elapsedMs: number }
  | { type: 'reasoning_start' }
  | { type: 'reasoning_glimpse'; text: string }
  | { type: 'reasoning_complete' }
  | { type: 'task_abort_requested' }
  | { type: 'task_aborted'; reason: string }
  | { type: 'compaction_start'; currentTokens: number; threshold: number }
  | { type: 'compaction_complete'; saved: number; summary?: string }
  | { type: 'todo_update'; items: TodoItem[] }
  | { type: 'command_action'; action: 'list_models'; models: ModelInfo[]; currentModel: string }
  | { type: 'command_action'; action: 'model_switched'; modelId: string; contextWindow: number }
  | { type: 'plan_generated'; plan: Plan; userRequest: string }
  | { type: 'plan_step_approved'; stepId: string; planId: string }
  | { type: 'plan_step_rejected'; stepId: string; planId: string }
  | { type: 'plan_step_pending'; stepId: string; planId: string; description: string }
  | { type: 'plan_step_skipped'; stepId: string; planId: string }
  | { type: 'plan_step_executing'; stepId: string; planId: string; description?: string }
  | { type: 'plan_step_complete'; stepId: string; planId: string; result: ToolResult }
  | { type: 'plan_step_failed'; stepId: string; planId: string; error: string }
  | { type: 'plan_approved'; planId: string }
  | { type: 'plan_rejected'; planId: string }
  | { type: 'plan_cancelled'; planId: string; reason: string }
  | { type: 'plan_mode_entered' }
  | { type: 'plan_mode_exited' }
  | { type: 'mode_restricted'; tool: string; error: string; message: string }
  | { type: 'mode_escalation_required'; tool: string; reason: string; pendingAction?: string }
  | { type: 'mode_escalation_accepted'; tool: string }
  | { type: 'mode_escalation_declined'; tool: string }
  | { type: 'plan_approval_required'; plan: Plan; userRequest: string }
  | { type: 'plan_mode_violation'; violations: Array<{ tool: string; path?: string; output: string }>; checkpointId?: string; rolledBack: boolean }
  | { type: 'turn_heartbeat'; stage: string; step: number; elapsedMs: number; tool?: string }
  | { type: 'step_cap_reached'; currentSteps: number; maxSteps: number }
  | { type: 'step_cap_continue'; continued: boolean }
  | { type: 'agent_thinking'; content: string; fullThought: string; agent: string }
  | { type: 'step_indicator'; step: number; totalSteps: string | number; stage: string }
  | { type: 'operation_file_created'; filePath: string; content: string; language: string }
  | { type: 'operation_file_read'; filePath: string; content: string; language: string }
  | { type: 'operation_file_edited'; filePath: string; oldContent: string; newContent: string; diff: string; changes?: unknown }
  | { type: 'operation_search_glob'; pattern: string; directory: string; matchCount: number; matches: string[] }
  | { type: 'operation_search_grep'; pattern: string; directory: string; matchCount: number; matches: unknown[] }
  | { type: 'operation_list_files'; directory: string; fileCount: number; files: string[] }
  | { type: 'operation_command_executed'; command: string; success: boolean; stdout: string; stderr: string }
  | { type: 'turn_state'; phase: string; stage: string; step: number }
  | { type: 'hyperdrive_entered'; mode: 'agent' | 'plan'; wasPlan: boolean }
  | { type: 'hyperdrive_exited'; mode: 'agent' | 'plan'; wasPlan: boolean }
  | { type: 'indexing_start'; totalFiles: number }
  | { type: 'indexing_progress'; indexed: number; total: number; currentFile?: string }
  | { type: 'indexing_complete'; indexed: number; total: number; chunks: number }
  | { type: 'watch_event'; event: string; filePath: string; command: string; timestamp: number }
  | { type: 'diff_preview'; tool: string; filePath: string; diff: string; oldContent?: string; newContent?: string }
  | { type: 'command_action'; action: 'show_watch_status'; entries: Array<{ pattern: string; command: string }> }
  | { type: 'clarification_required'; question: string; options: string[]; allowFreeform: boolean; recommended?: string; allowChooseAll?: boolean; selectionMode?: 'single' | 'multiple'; fields?: ClarificationField[] }
  | { type: 'model_capability_warning'; model: string; missing: string[]; message: string }
  | { type: 'intent_detected'; intent: string; confidence: number; reasons?: string[] }
  | { type: 'rag_queried'; resultCount: number; elapsed: number }
  | { type: 'subagent_event'; subagentId: string; parentEvent: EngineEvent }
  | { type: 'discord_connected'; code: string; message: string; recoverable: boolean }
  | { type: 'discord_message'; code: string; message: string; recoverable: boolean }
  | { type: 'discord_error'; code: string; message: string; recoverable: boolean }
  // Tree of Thoughts events
  | { type: 'tot_start'; problem: string }
  | { type: 'tot_thought_generated'; thoughtId: string; content: string; parentId?: string; depth: number }
  | { type: 'tot_evaluation'; thoughtId: string; score: number }
  | { type: 'tot_complete'; bestThoughtId: string; score: number; content: string }
  // Research Mode events
  | { type: 'research_start'; question: string }
  | { type: 'research_query'; queryId: string; question: string; sources: string }
  | { type: 'research_subagent_complete'; queryId: string; result: { queryId: string; question: string; answer: string; sources: string[]; elapsed: number } }
  | { type: 'research_synthesis'; resultCount: number }
  | { type: 'research_complete'; report: string }
  | { type: 'agent_message'; message: Record<string, unknown> }
  | { type: 'decomposition_start'; task: string }
  | { type: 'decomposition_ready'; subtaskCount: number }
  | { type: 'decomposition_complete'; subResultCount: number; totalElapsed: number }
  | { type: 'decomposition_fallback'; task: string }
  | { type: 'reflection_complete'; result: Record<string, unknown> }
  | { type: 'decision_made'; messageClass: string; executionPath: string; confidence: number; reasoning: string }
  | { type: 'token_usage'; totalTokens: number; contextWindow: number; turnTokens?: number; costUsd?: number; inputTokens?: number; outputTokens?: number; inputPrice?: number; outputPrice?: number; reservedTokens?: number; streamingTokens?: number; estimated?: boolean }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'agent_switched'; agent: { id: string; name: string; mode: string; color?: string } }
  | { type: 'context_warning'; currentTokens: number; threshold: number; percentage: number }
  | { type: 'crew_activity'; crewId: string; crewName?: string; activity: 'speaking' | 'thinking' | 'done'; content?: string }
  | { type: 'crew_feedback'; crewId: string; positive: boolean }
  | { type: 'crew_worker_spawned'; workerId: string; crewId: string; crewName: string; callsign: string; task: string }
  | { type: 'crew_worker_progress'; workerId: string; crewId: string; status: 'running' | 'verifying' | 'retrying' | 'blocked' | 'done' | 'error'; message?: string }
  | { type: 'crew_worker_complete'; workerId: string; crewId: string; crewName: string; callsign: string; success: boolean; output: string; elapsed: number }
  | { type: 'crew_mission_start'; missionId: string; crews: string[]; task: string }
  | { type: 'crew_mission_retry'; missionId: string; attempt: number; maxRetries: number }
  | { type: 'crew_mission_complete'; missionId: string; success: boolean; synthesized: string }
  | { type: 'crew_inter_message'; from: string; to: string; content: string }
  // Checkpoint events for autonomous task execution
  | { type: 'checkpoint_required'; sessionId: string; step: { description: string; expectedOutcome: string; error?: string }; failures: Array<{ description: string; failureReason: string; attemptNumber: number }>; checkpointId: string }
  | { type: 'checkpoint_resolved'; checkpointId: string; action: string }
  // Escalation event — emitted when agent is stuck and needs manual intervention
  | { type: 'assistance_required'; sessionId: string; checkpointId: string; step: { description: string; expectedOutcome: string; error?: string }; failures: Array<{ description: string; failureReason: string; attemptNumber: number }>; consecutiveCheckpoints: number; message: string }
  // Progress events for self-healing autonomous loop
  | { type: 'task_progress'; phase: string; stepIndex: number; completed: number; total: number };

export interface FormattedResponse {
  content: string;
  toolsUsed: string[];
  tokensUsed: number;
}

export interface TodoItem {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

export type EventHandler = (event: EngineEvent) => void;

export interface EventBus {
  emit(event: EngineEvent): void;
  on(handler: EventHandler): () => void;
  off(handler: EventHandler): void;
}
