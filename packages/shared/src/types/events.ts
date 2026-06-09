import type { Message } from './message.js';
import type { ModelInfo } from './provider.js';
import type { ToolResult } from './tool.js';

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
  | { type: 'permission_required'; tool: string; path: string; riskLevel: string }
  | { type: 'token_update'; used: number; available: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean; actions?: RemediationAction[] }
  | { type: 'provider_error'; provider: string; model: string; statusCode?: number; message: string; recoverable: boolean; actions?: RemediationAction[] }
  | { type: 'tool_executing'; tool: string; description: string; startTime: number }
  | { type: 'tool_complete'; tool: string; result: ToolResult; elapsed: number }
  | { type: 'agent_spawned'; agentId: string; task: string; startTime: number }
  | { type: 'agent_progress'; agentId: string; status: string }
  | { type: 'agent_complete'; agentId: string; summary: string; elapsed: number }
  | { type: 'task_consolidated_time'; totalElapsed: number; breakdown: Array<{ tool: string; elapsed: number }> }
  | { type: 'task_backgrounded'; taskId: string }
  | { type: 'steer_message'; taskId: string; instruction: string }
  | { type: 'reminder_fired'; taskId: string; name: string; message: string }
  | { type: 'background_task_complete'; taskId: string; summary: string }
  | { type: 'reasoning_start' }
  | { type: 'reasoning_glimpse'; text: string }
  | { type: 'reasoning_complete' }
  | { type: 'task_abort_requested' }
  | { type: 'task_aborted'; reason: string }
  | { type: 'compaction_start'; currentTokens: number; threshold: number }
  | { type: 'compaction_complete'; saved: number }
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
  | { type: 'indexing_start'; totalFiles: number }
  | { type: 'indexing_progress'; indexed: number; total: number; currentFile?: string }
  | { type: 'indexing_complete'; indexed: number; total: number; chunks: number }
  | { type: 'watch_event'; event: string; filePath: string; command: string; timestamp: number }
  | { type: 'diff_preview'; tool: string; filePath: string; diff: string; oldContent?: string; newContent?: string }
  | { type: 'command_action'; action: 'show_watch_status'; entries: Array<{ pattern: string; command: string }> }
  | { type: 'clarification_required'; question: string; options: string[]; allowFreeform: boolean; recommended?: string; allowChooseAll?: boolean }
  | { type: 'model_capability_warning'; model: string; missing: string[]; message: string }
  | { type: 'intent_detected'; intent: string; confidence: number }
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
  | { type: 'token_usage'; totalTokens: number; contextWindow: number }
  | { type: 'reasoning_delta'; content: string };

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
