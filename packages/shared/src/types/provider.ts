export interface ProviderConfig {
  id: ProviderId;
  name: string;
  type: 'cloud' | 'local';
  apiKeyRequired: boolean;
  baseUrlConfigurable: boolean;
  defaultBaseUrl?: string;
}

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';

export interface ModelInfo {
  id: string;
  name: string;
  providerId: ProviderId;
  contextWindow: number;
  capabilities: ModelCapability[];
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
}

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: CompletionToolCall[];
}

export interface CompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface CompletionChunk {
  type: 'text_delta' | 'tool_call_delta' | 'reasoning_delta' | 'done';
  content?: string;
  toolCall?: Partial<CompletionToolCall>;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
