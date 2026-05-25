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
  source: 'builtin' | 'plugin' | 'mcp';
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
  | 'mcp_integration'
  | 'workspace_ide'
  | 'scheduler';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
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
}
