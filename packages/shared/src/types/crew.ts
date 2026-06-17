export type CrewEmotion =
  | 'professional'
  | 'friendly'
  | 'witty'
  | 'kind'
  | 'funny'
  | 'arrogant'
  | 'flirty'
  | 'happy'
  | 'sad'
  | 'sarcastic';

export type CollaborationProtocol = 'standard' | 'parallel' | 'sequential' | 'debate' | 'handoff';

export interface CrewResourceQuota {
  maxTokensPerTurn?: number;
  maxTokensPerSession?: number;
  maxCpuTimeMs?: number;
  maxMemoryBytes?: number;
}

import type { PermissionRule } from './permission.js';

export interface Crew {
  id: string;
  name: string;
  title?: string;
  callsign: string;
  systemPrompt: string;
  emotion?: CrewEmotion;
  isDefault: boolean;
  enabled: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
  tools?: string[];
  permissions?: PermissionRule[];
  model?: { provider: string; modelId: string };
  protocol?: CollaborationProtocol;
  quotas?: CrewResourceQuota;
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewCreateInput {
  id: string;
  name: string;
  title?: string;
  callsign: string;
  systemPrompt: string;
  emotion?: CrewEmotion;
  isDefault?: boolean;
  enabled?: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
  tools?: string[];
  permissions?: PermissionRule[];
  model?: { provider: string; modelId: string };
  protocol?: CollaborationProtocol;
  quotas?: CrewResourceQuota;
  color?: string;
  icon?: string;
}

export interface SessionCrewState {
  crewId: string;
  enabled: boolean;
  lastActive?: string;
  messageCount?: number;
}
