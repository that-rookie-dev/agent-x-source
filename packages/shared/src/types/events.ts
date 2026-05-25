import type { Message } from './message.js';
import type { ModelInfo } from './provider.js';
import type { ToolResult } from './tool.js';

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
  | { type: 'loading_start'; stage: string }
  | { type: 'loading_end' }
  | { type: 'processing_start'; taskDescription: string }
  | { type: 'processing_progress'; stage: string; progress: number }
  | { type: 'processing_complete'; result: FormattedResponse }
  | { type: 'permission_required'; tool: string; path: string; riskLevel: string }
  | { type: 'token_update'; used: number; available: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean; actions?: RemediationAction[] }
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
  | { type: 'command_action'; action: 'model_switched'; modelId: string };

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
