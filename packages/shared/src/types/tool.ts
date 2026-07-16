import type { ParallelMode } from './communication.js';

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  modelDescription: string;
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
  schema: ToolParameterSchema;
  examples?: string[];
  composable: boolean;
  source: 'builtin' | 'plugin' | 'integration';
  parallelMode?: ParallelMode;
  isInteractive?: boolean;
  isDestructive?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export type ToolCategory =
  | 'filesystem'
  | 'code_intelligence'
  | 'shell_process'
  | 'git_vcs'
  | 'package_managers'
  | 'web_network'
  | 'database'
  | 'documents'
  | 'testing'
  | 'containers_infra'
  | 'communication'
  | 'ai_meta'
  | 'browser_automation'
  | 'system_os'
  | 'security_crypto'
  | 'data_processing'
  | 'project_management'
  | 'media_image'
  | 'workspace_ide'
  | 'scheduler'
  | 'agent_orchestration'
  | 'agent_meta'
  | 'integrations';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
  maxItems?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

import type { SessionContextKind } from './session-context.js';

export interface ToolExecutionContext {
  sessionId: string;
  scopePath: string;
  agentId?: string;
  /** Drives memory fabric read/write scoping for tools. */
  contextKind?: SessionContextKind;
  timeout: number;
  /** Voice comms turn — tighter tool time budgets. */
  voiceTurn?: boolean;
  /** Originating messaging channel for this turn (telegram, slack, etc.). */
  sourceChannel?: string;
  /** Originating channel thread / chat / recipient id (e.g. Telegram chat_id, Slack channel, email address). */
  sourceThreadId?: string;
  /** Originating channel message id (e.g. Slack thread_ts, email Message-Id) used for threaded replies. */
  sourceMessageId?: string;
  onOutput?: (output: string) => void;
  /** Abort signal that should be checked by long-running tool handlers. */
  signal?: AbortSignal;
}
