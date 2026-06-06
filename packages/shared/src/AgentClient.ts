import type { EngineEvent } from './types/events.js';

/**
 * Unified AgentClient interface used by all UI surfaces (TUI, Web, VS Code).
 * Abstracts direct Agent, WebSocket+SSE, and postMessage-based communication
 * behind a single contract.
 */
export interface AgentClient {
  /** Send a chat message */
  sendMessage(text: string, context?: MessageContext): Promise<void>;

  /** Cancel the current processing */
  cancel(): Promise<void>;

  /** Respond to a permission request */
  respondToPermission(choice: 'allow_once' | 'allow_always' | 'deny'): Promise<void>;

  /** Subscribe to engine events */
  onEvent(handler: (event: EngineEvent) => void): () => void;

  /** Subscribe to stream chunks */
  onStreamChunk(handler: (content: string, fullContent: string) => void): () => void;

  /** Subscribe to tool execution events */
  onToolEvent(handler: (tool: string, status: 'executing' | 'complete' | 'error', detail?: ToolDetail) => void): () => void;

  /** Subscribe to permission requests */
  onPermissionRequest(handler: (toolName: string, path: string, riskLevel: string) => void): () => void;

  /** Subscribe to plan events */
  onPlanEvent(handler: (event: PlanEvent) => void): () => void;

  /** Subscribe to sub-agent events */
  onSubAgentEvent(handler: (event: SubAgentEvent) => void): () => void;

  /** Subscribe to reasoning events */
  onReasoning(handler: (text: string) => void): () => void;

  /** Subscribe to todo updates */
  onTodo(handler: (items: TodoItem[]) => void): () => void;

  /** Subscribe to errors */
  onError(handler: (message: string, code?: string) => void): () => void;

  /** Subscribe to loading state changes */
  onLoading(handler: (loading: boolean) => void): () => void;

  /** Dispose and clean up all subscriptions */
  dispose(): Promise<void>;

  /** Check if the client is connected */
  readonly connected: boolean;
}

export interface MessageContext {
  userId?: string;
  channelId?: string;
  sourceChannel?: string;
  attachments?: Array<{ name: string; content: string }>;
}

export interface ToolDetail {
  result?: { success?: boolean; output?: string };
  elapsed?: number;
  error?: string;
}

export interface PlanEvent {
  type: 'plan_created' | 'plan_step_completed' | 'plan_approved' | 'plan_rejected';
  planId?: string;
  details?: Record<string, unknown>;
}

export interface SubAgentEvent {
  type: 'spawned' | 'progress' | 'completed' | 'failed';
  agentId?: string;
  task?: string;
  output?: string;
}

export { type TodoItem } from '../types/events.js';
