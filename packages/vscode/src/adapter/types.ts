import type * as vscode from 'vscode';
import type {
  EngineEvent,
  Plan,
  ToolResult,
  ProviderId,
  AgentXConfig,
  RemediationAction,
  TodoItem,
  VisualUpdate,
  SessionStatus,
} from '@agentx/shared';

export type EngineStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'error'
  | 'disposed';

export interface EngineState {
  status: EngineStatus;
  workspaceRoot: string | null;
  sessionId: string | null;
  providerId: ProviderId | null;
  modelId: string | null;
  toolCount: number;
  watcherCount: number;
  schedulerCount: number;
  planModeEnabled: boolean;
  processing: boolean;
  error: string | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls: ChatToolCall[] | null;
  tokenCount: number;
  tokenCost?: number;
  createdAt: string;
  elapsed?: number;
  turnId?: string;
  reasoning?: string;
  metadata?: ChatMessageMetadata;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export interface ChatMessageMetadata {
  rawTurnId?: string;
  channel?: string;
  normalizationWarnings?: number;
  providerRequestId?: string;
}

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'error' | 'denied';
  startTime: number;
  endTime?: number;
  elapsed?: number;
  result?: ToolResult;
  args?: Record<string, unknown>;
}

export interface PermissionRequest {
  tool: string;
  path: string;
  riskLevel: string;
  timestamp: number;
}

export type PermissionChoice = 'allow_once' | 'allow_always' | 'deny';

export interface PlanState {
  plan: Plan | null;
  userRequest: string | null;
  currentStepId: string | null;
  awaitingApproval: boolean;
  awaitingStepApproval: string | null;
}

export interface SubAgentState {
  agentId: string;
  task: string;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  elapsed?: number;
  summary?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  status: SessionStatus;
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenUsed: number;
  tokenAvailable: number;
  crewId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StatusBarState {
  providerId: ProviderId | null;
  modelId: string | null;
  tokenUsed: number;
  tokenTotal: number;
  tokenPercentage: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  isProcessing: boolean;
  isNearLimit: boolean;
  isAtLimit: boolean;
  planMode: boolean;
  watcherCount: number;
  schedulerCount: number;
  subAgentCount: number;
}

export interface TokenState {
  used: number;
  total: number;
  remaining: number;
  percentage: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
}

export interface StreamState {
  isActive: boolean;
  content: string;
  fullContent: string;
}

export interface ReasoningState {
  isActive: boolean;
  glimpses: string[];
}

export interface IndexingState {
  isActive: boolean;
  indexed: number;
  total: number;
  currentFile: string | null;
  chunks: number | null;
}

export interface ResearchState {
  isActive: boolean;
  question: string | null;
  queries: ResearchQuery[];
  synthesisResultCount: number | null;
  report: string | null;
}

export interface ResearchQuery {
  queryId: string;
  question: string;
  sources: string;
  completed: boolean;
  result?: {
    answer: string;
    sources: string[];
    elapsed: number;
  };
}

export interface ConfigState {
  isConfigured: boolean;
  isSetupComplete: boolean;
  config: AgentXConfig | null;
  firstRun: boolean;
}

export type MessageCallback = (message: ChatMessage) => void;
export type StreamCallback = (chunk: { content: string; fullContent: string }) => void;
export type ToolEventCallback = (execution: ToolExecution) => void;
export type PermissionCallback = (request: PermissionRequest) => void;
export type ErrorCallback = (error: { code: string; message: string; recoverable: boolean; actions?: RemediationAction[] }) => void;
export type PlanEventCallback = (event: EngineEvent) => void;
export type SubAgentEventCallback = (state: SubAgentState) => void;
export type ReasoningCallback = (state: ReasoningState) => void;
export type MetaCallback = (event: EngineEvent) => void;
export type VisualCallback = (update: VisualUpdate) => void;
export type TokenUpdateCallback = (state: TokenState) => void;
export type TodoCallback = (items: TodoItem[]) => void;
export type IndexingCallback = (state: IndexingState) => void;
export type ResearchCallback = (state: ResearchState) => void;
export type LoadingCallback = (stage: string | null) => void;
export type ProcessingCallback = (state: { taskDescription: string; stage: string; progress: number } | null) => void;
export type DiffPreviewCallback = (preview: { tool: string; filePath: string; diff: string; oldContent?: string; newContent?: string }) => void;
export type ClarificationCallback = (request: { question: string; options: string[]; allowFreeform: boolean }) => void;
export type CompactionCallback = (event: { type: 'start' | 'complete'; currentTokens?: number; threshold?: number; saved?: number }) => void;
export type WatchEventCallback = (event: { event: string; filePath: string; command: string; timestamp: number }) => void;
export type BackgroundTaskCallback = (event: { taskId: string; summary?: string }) => void;
export type ReminderCallback = (event: { taskId: string; name: string; message: string }) => void;

export interface Disposable {
  dispose(): void;
}

export interface EngineAdapterOptions {
  workspaceRoot: string;
  context: vscode.ExtensionContext;
  autoInitialize?: boolean;
  crashRecoveryTimeout?: number;
  streamThrottleMs?: number;
}

export type LifecycleEvent =
  | { type: 'initializing' }
  | { type: 'ready'; sessionId: string }
  | { type: 'error'; error: string }
  | { type: 'workspace_changed'; newRoot: string }
  | { type: 'restarting' }
  | { type: 'disposed' }
  | { type: 'crash_detected'; stuckFor: number }
  | { type: 'crash_recovered' };

export type LifecycleCallback = (event: LifecycleEvent) => void;
