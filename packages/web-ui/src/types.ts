export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokenCount?: number;
  toolCalls?: ToolCall[];
  subAgents?: SubAgentActivity[];
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  tool: string;
  description: string;
  status: 'running' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
  result?: string;
  input?: Record<string, unknown>;
}

export interface SubAgentActivity {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
  summary?: string;
  steps?: SubAgentStep[];
}

export interface SubAgentStep {
  type: 'read' | 'search' | 'edit' | 'run' | 'think';
  label: string;
  detail?: string;
  status: 'running' | 'complete';
  startTime: number;
}

export interface SessionInfo {
  id: string;
  provider: string;
  model: string;
  tokensUsed: number;
  totalCost: number;
  messageCount: number;
  createdAt: string;
}

export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; toolCall: ToolCall }
  | { type: 'tool_end'; toolCallId: string; result: string }
  | { type: 'agent_spawn'; agent: SubAgentActivity }
  | { type: 'agent_step'; agentId: string; step: SubAgentStep }
  | { type: 'agent_done'; agentId: string; summary: string }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string };
