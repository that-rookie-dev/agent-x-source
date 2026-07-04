export interface ProviderConfig {
  id: ProviderId;
  name: string;
  type: 'cloud' | 'local';
  apiKeyRequired: boolean;
  baseUrlConfigurable: boolean;
  defaultBaseUrl?: string;
}

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'lmstudio'
  | 'moonshot'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'together'
  | 'xai'
  | 'fireworks'
  | 'perplexity'
  | 'azure'
  | 'cohere'
  | 'commandcode'
  | 'opencode'
  | 'opencode-zen';

export type ReasoningEffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Provider-normalized reasoning / thinking controls for a model. */
export interface ModelReasoningInfo {
  supported: boolean;
  effortLevels: ReasoningEffortLevel[];
  defaultEffort?: ReasoningEffortLevel;
  /** Request parameter used by this provider (OpenAI-compat Gemini uses reasoning_effort). */
  control?: 'reasoning_effort' | 'thinking_level' | 'thinking_budget' | 'output_config.effort';
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: ProviderId;
  contextWindow: number;
  /** Max output tokens when reported by the provider API. */
  outputTokenLimit?: number;
  capabilities: ModelCapability[];
  reasoning?: ModelReasoningInfo;
  pricing?: ModelPricing;
}

export type ModelCapability =
  | 'text'
  | 'vision'
  | 'function_calling'
  | 'streaming'
  | 'json_mode'
  | 'reasoning';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface CompletionRequest {
  messages: CompletionMessage[];
  model: string;
  tools?: ToolSchema[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Reasoning/thinking depth — mapped per provider (Gemini: reasoning_effort / thinking_level). */
  reasoningEffort?: ReasoningEffortLevel;
  signal?: AbortSignal;
}

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: CompletionToolCall[];
  reasoning?: string;
}

export interface CompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  thought_signature?: string;
}

export interface CompletionChunk {
  type: 'text_delta' | 'tool_call_delta' | 'reasoning_delta' | 'done';
  content?: string;
  toolCall?: Partial<CompletionToolCall>;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
