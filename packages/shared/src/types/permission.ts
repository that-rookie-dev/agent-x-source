export interface Permission {
  id: string;
  sessionId: string;
  toolName: string;
  targetPath: string | null;
  decision: PermissionDecision;
  createdAt: string;
}

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  targetPath: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  integrationPreview?: import('./integrations.js').IntegrationActionPreview;
}

export interface PermissionRule {
  action: string;
  pattern: string;
  effect: 'allow' | 'deny' | 'ask';
  comment?: string;
}

export type PermissionAction = `tool:${string}` | `subagent:${string}` | `network:${string}`;
