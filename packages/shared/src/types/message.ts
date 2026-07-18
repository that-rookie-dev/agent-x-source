import type { CompactionMarker, NormalizedAttachment } from './communication.js';

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
  /** Resolved attachments (extracted text for docs, data-uri for images). */
  attachments?: NormalizedAttachment[];
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
  /** Voice engine that produced/ingested this message. */
  engine?: string;
  /** Provider used for the response. */
  provider?: string;
  /** Model used for the response. */
  model?: string;
}

export type InputType =
  | 'conversation'
  | 'command'
  | 'steer';
