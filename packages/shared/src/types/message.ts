import type { CompactionMarker } from './communication.js';

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls: ToolCall[] | null;
  tokenCount: number;
  tokenCost?: number;
  createdAt: string;
  elapsed?: number;
  turnId?: string;
  reasoning?: string;
  metadata?: MessageMetadata;
  compactionMarker?: CompactionMarker;
  crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] };
  /** Chronological UI parts (text, tools, questionnaires) — persisted for restore. */
  parts?: Array<Record<string, unknown>>;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export interface MessageMetadata {
  rawTurnId?: string;
  channel?: string;
  normalizationWarnings?: number;
  providerRequestId?: string;
}

export type InputType =
  | 'conversation'
  | 'command'
  | 'steer';
