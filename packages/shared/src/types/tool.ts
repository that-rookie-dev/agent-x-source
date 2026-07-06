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

export interface ToolExecutionContext {
  sessionId: string;
  scopePath: string;
  agentId?: string;
  timeout: number;
  mode?: 'agent' | 'plan';
  /** Voice comms turn — tighter tool time budgets. */
  voiceTurn?: boolean;
  onOutput?: (output: string) => void;
}
