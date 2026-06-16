import type { PermissionRule } from '@agentx/shared';

export interface AgentInfo {
  id: string;
  name: string;
  mode: 'agent' | 'plan';
  description: string;
  defaultTools: string[];
  deniedTools: string[];
  permissions?: PermissionRule[];
  prompt: string;
  model?: string;
  temperature?: number;
  steps?: number;
  color?: string;
}
