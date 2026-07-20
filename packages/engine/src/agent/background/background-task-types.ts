/**
 * Shared types for durable background task tracking.
 *
 * A background task is any unit of work that outlives the UI session that
 * spawned it — primarily sub-agent delegations, but the same primitives are
 * reusable for any background work.
 */

export interface BackgroundTaskChannelContext {
  channel?: string;
  threadId?: string;
  messageId?: string;
}

export interface BackgroundTaskResourceUsage {
  cpuTime?: number;
  memoryPeak?: number;
  tokenUsage?: { input: number; output: number };
}

export type BackgroundTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BackgroundTaskRecord {
  id: string;
  parentSessionId: string;
  childSessionId?: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: BackgroundTaskStatus;
  result?: string;
  error?: string;
  resourceUsage?: BackgroundTaskResourceUsage;
  channelContext?: BackgroundTaskChannelContext;
  background: boolean;
  consumed: boolean;
  /** Last in-process heartbeat timestamp (not persisted — ephemeral health). */
  lastHeartbeat?: number;
  startTime?: number;
  endTime?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BackgroundTaskSummary {
  id: string;
  parentSessionId: string;
  childSessionId?: string;
  instruction: string;
  status: BackgroundTaskStatus;
  elapsedMs: number;
  startTime?: number;
  endTime?: number;
}

export interface BackgroundTaskStatusEvent {
  type: 'background_task_status';
  sessionId: string;
  tasks: BackgroundTaskSummary[];
}

export interface BackgroundTaskProgressEvent {
  type: 'background_task_progress';
  taskId: string;
  sessionId: string;
  status: BackgroundTaskStatus;
  elapsedMs: number;
  instruction: string;
  snippet?: string;
}

export interface BackgroundTaskCompleteEvent {
  type: 'background_task_complete';
  taskId: string;
  sessionId: string;
  childSessionId?: string;
  success: boolean;
  elapsedMs: number;
  tokensUsed?: number;
  result?: string;
  error?: string;
  instruction: string;
  inboundChannel?: string;
  inboundThreadId?: string;
  inboundMessageId?: string;
}

/**
 * Runtime sub-agent task record. Mirrors the in-memory SubAgentTask shape used
 * by SubAgentManager so it can be passed directly into BackgroundTaskService.
 */
export interface SubAgentRecord {
  id: string;
  parentSessionId?: string;
  childSessionId?: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: BackgroundTaskStatus;
  result?: string;
  error?: string;
  resourceUsage?: BackgroundTaskResourceUsage;
  background?: boolean;
  consumed?: boolean;
  startTime?: number;
  endTime?: number;
  /** Backwards-compatible inbound channel context used by SubAgentManager. */
  inboundChannel?: string;
  inboundThreadId?: string;
  inboundMessageId?: string;
  /** Normalized channel context for persistence. */
  channelContext?: BackgroundTaskChannelContext;
  /** In-memory execution metadata. */
  abortController?: AbortController;
  workDir?: string;
  deniedTools?: string[];
  /** Ephemeral health marker — not persisted. */
  lastHeartbeat?: number;
  createdAt?: number;
  updatedAt?: number;
}
