// ============================================================================
// Agent-X Unified Communication Contracts
// Phase 1: Shared Type Contracts
// Based on: UNIFIED_IMPLEMENTATION_BLUEPRINT.md Section 4
// ============================================================================

// === INGRESS CONTRACTS ===

export type ChannelKind = 'web' | 'api' | 'discord' | 'telegram';

export interface InternalUserTurn {
  turnId: string;
  sessionId: string;
  channel: ChannelKind;
  userId: string;
  receivedAt: number;
  text: string;
  attachments: TurnAttachment[];
  metadata: Record<string, unknown>;
}

export interface TurnAttachment {
  id: string;
  type: 'file' | 'image' | 'url';
  name: string;
  mimeType?: string;
  data?: string;
  url?: string;
  resolvedAt?: number;
}

export interface NormalizationWarning {
  pass: string;
  field: string;
  original: string;
  repaired: string;
  reason: string;
}

export interface NormalizedTurn {
  turnId: string;
  sessionId: string;
  cleanText: string;
  cleanAttachments: NormalizedAttachment[];
  warnings: NormalizationWarning[];
}

export interface NormalizedAttachment {
  id: string;
  type: 'file' | 'image' | 'url';
  name: string;
  mimeType: string;
  content: string;
  isInline: boolean;
}

// === PROMPT CONTRACTS ===

export interface PromptBundle {
  stablePrefix: string;
  cacheBoundary: string;
  dynamicSuffix: string;
  volatileSuffix: string;
  fullSystemPrompt: string;
  stableHash: string;
  providerOverlay?: string;
}

// === PROVIDER REQUEST CONTRACTS ===

export interface ProviderPlan {
  requestId: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  messages: ProviderMessage[];
  tools: ProviderToolDef[];
  toolChoice: 'auto' | 'required' | 'none';
  generation: ProviderGenerationConfig;
  http: ProviderHttpConfig;
  route: ProviderRouteId;
}

export interface ProviderGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface ProviderHttpConfig {
  timeoutMs: number;
  maxRetries: number;
  headers: Record<string, string>;
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ProviderContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
  reasoning?: string;
}

export interface ProviderContentPart {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  image_url?: { url: string };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ProviderContentPart[];
  is_error?: boolean;
}

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// === UNIFIED STREAMING EVENT CONTRACTS ===

export type AgentXStreamEvent =
  // Turn lifecycle
  | { type: 'turn.start'; turnId: string; sessionId: string; ts: number }
  | { type: 'turn.end'; turnId: string; stopReason: string; usage: UsageInfo; ts: number }
  | { type: 'turn.error'; turnId: string; code: string; message: string; ts: number }

  // Assistant text (streaming deltas)
  | { type: 'text.start'; messageId: string; ts: number }
  | { type: 'text.delta'; messageId: string; delta: string; ts: number }
  | { type: 'text.end'; messageId: string; ts: number }

  // Reasoning / thinking
  | { type: 'reasoning.start'; reasoningId: string; ts: number }
  | { type: 'reasoning.delta'; reasoningId: string; delta: string; ts: number }
  | { type: 'reasoning.end'; reasoningId: string; ts: number }

  // Tool call input (streamed arguments)
  | { type: 'tool.input.start'; toolCallId: string; toolName: string; ts: number }
  | { type: 'tool.input.delta'; toolCallId: string; delta: string; ts: number }
  | { type: 'tool.input.end'; toolCallId: string; ts: number }

  // Tool execution
  | { type: 'tool.execute.start'; toolCallId: string; toolName: string; ts: number }
  | { type: 'tool.execute.progress'; toolCallId: string; message: string; ts: number }
  | { type: 'tool.execute.end'; toolCallId: string; ok: boolean; durationMs: number; ts: number }

  // Compaction
  | { type: 'compaction.start'; sessionId: string; currentTokens: number; threshold: number; ts: number }
  | { type: 'compaction.end'; sessionId: string; ok: boolean; tokensSaved: number; ts: number }

  // Multi-segment streaming (NEW_SEGMENT pattern)
  | { type: 'segment.start'; segmentId: string; label: string; ts: number }
  | { type: 'segment.end'; segmentId: string; ts: number }

  // Provider-level
  | { type: 'provider.error'; turnId: string; code: string; message: string; rawBody?: string; ts: number }
  | { type: 'provider.retry'; turnId: string; attempt: number; maxAttempts: number; reason: string; ts: number };

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

// === FAILOVER CONTRACTS ===

export enum FailoverReason {
  AUTH = 'auth',
  BILLING = 'billing',
  RATE_LIMIT = 'rate_limit',
  OVERLOADED = 'overloaded',
  SERVER_ERROR = 'server_error',
  TIMEOUT = 'timeout',
  CONTEXT_OVERFLOW = 'context_overflow',
  FORMAT = 'format',
  TOOL_REPAIR_FAILED = 'tool_repair_failed',
  POLICY_BLOCK = 'policy_block',
  MODEL_NOT_FOUND = 'model_not_found',
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  reason: FailoverReason;
  retryable: boolean;
  shouldCompress: boolean;
  shouldRotateCredential: boolean;
  shouldFallback: boolean;
  providerStatus?: number;
  providerMessage?: string;
}

export type RetryAction =
  | { type: 'compact_and_retry' }
  | { type: 'rotate_profile_and_retry' }
  | { type: 'fallback_model_and_retry' }
  | { type: 'inject_retry_instruction'; instruction: string }
  | { type: 'surface_error'; message: string };

// === COMPACTION CONTRACTS ===

export interface CompactionSummary {
  goal: string;
  constraints: string;
  done: string[];
  inProgress: string[];
  blocked: string[];
  keyDecisions: string[];
  nextSteps: string[];
  criticalContext: string[];
  relevantFiles: string[];
}

export interface CompactionMarker {
  messageId: string;
  summaryIndex: number;
  tailStartIndex: number;
  createdAt: number;
}

// === PROVIDER ROUTE CONTRACTS ===

export type ProviderRouteId = string;

export interface ProviderRoute {
  id: ProviderRouteId;
  provider: string;
  protocol: ProviderProtocol;
  endpoint: ProviderEndpoint;
  auth: ProviderAuth;
  framing: ProviderFraming;
}

export interface ProviderProtocol {
  convertMessages(messages: ProviderMessage[]): unknown;
  convertTools(tools: ProviderToolDef[]): unknown;
  normalizeEvent(rawChunk: unknown, state: unknown): AgentXStreamEvent | null;
  validateResponse(response: unknown): void;
}

export interface ProviderEndpoint {
  baseUrl: string;
  path: string;
  queryParams?: Record<string, string>;
}

export interface ProviderAuth {
  type: 'bearer' | 'api-key' | 'oauth';
  getHeaders(): Promise<Record<string, string>>;
}

export type ProviderFraming = 'sse' | 'json-lines' | 'aws-event-stream';

// === TRANSPORT CONTRACT ===

export interface ProviderTransport {
  id: string;
  canHandle(plan: ProviderPlan): boolean;
  preflight(plan: ProviderPlan): ProviderPlan;
  stream(plan: ProviderPlan, signal: AbortSignal): AsyncIterable<AgentXStreamEvent>;
}

// === TOOL EXECUTION CONTRACTS ===

export enum ToolCallStatus {
  PENDING = 'pending',
  INPUT_DONE = 'input_done',
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
  DENIED = 'denied',
}

export enum ParallelMode {
  NEVER = 'never',
  SAFE = 'safe',
  PATH_SCOPED = 'path_scoped',
  INTEGRATION_CHECK = 'integration_check',
  SEQUENTIAL = 'sequential',
}

export interface ToolCallState {
  toolCallId: string;
  streamKey: string | number;
  toolName: string;
  rawInput: string;
  parsedInput?: unknown;
  status: ToolCallStatus;
  error?: { code: string; message: string };
  repairApplied?: boolean;
  durationMs?: number;
}

export interface FinalAssistantMessage {
  messageId: string;
  text: string;
  reasoning?: string;
  toolCalls: NormalizedToolCall[];
  usage: UsageInfo;
  stopReason: string;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
  durationMs?: number;
  error?: string;
  rawArguments?: string;
}
