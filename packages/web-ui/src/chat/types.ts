import type { ChatMessage } from '../api';
import type { TodoItem } from '../api';

export interface ToolCall {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  streamOutput?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: Record<string, unknown>;
}

export interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  toolCalls?: ToolCall[];
  kind?: 'sub_agent' | 'crew_worker';
}

export interface PartEntry {
  type: 'text' | 'tool' | 'subagent';
  id: string;
  content?: string;
  tool?: ToolCall;
  agent?: SubAgent;
}

export interface UIMessage extends ChatMessage {
  thinking?: string;
  thinkingStartedAt?: number;
  thinkingDoneAt?: number;
  toolCalls?: ToolCall[];
  subAgents?: SubAgent[];
  todos?: TodoItem[];
  streaming?: boolean;
  plan?: string[];
  attachments?: { name: string }[];
  turnTokens?: number;
  turnCostUsd?: number;
  crew?: {
    crewId: string;
    name: string;
    callsign: string;
    color?: string;
    icon?: string;
    confidence?: string;
    reasons?: string[];
  };
  parts?: PartEntry[];
  isModeChange?: { from: string; to: string };
}

export interface VisibleMessageItem {
  msg: UIMessage;
  isLastUser: boolean;
}
