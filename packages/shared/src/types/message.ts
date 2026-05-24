export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls: ToolCall[] | null;
  tokenCount: number;
  createdAt: string;
  elapsed?: number;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export type InputType =
  | 'conversation'
  | 'command'
  | 'steer';
