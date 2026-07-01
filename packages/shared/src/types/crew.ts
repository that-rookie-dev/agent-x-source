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

export type CrewSource = 'custom' | 'hub';

export interface Crew {
  id: string;
  name: string;
  title?: string;
  callsign: string;
  systemPrompt: string;
  description?: string;
  emotion?: CrewEmotion;
  /** Provenance: user-created or recruited from Hub catalog. */
  source?: CrewSource;
  /** FK to crew_catalog when source is hub. */
  catalogId?: string;
  /** Denormalized search blob for FTS. */
  searchText?: string;
  /** When false, excluded from automatic crew suggestions. */
  suggestable?: boolean;
  isDefault: boolean;
  enabled: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
  tools?: string[];
  /** Search synonyms / alternate spellings / related skill terms — indexed for FTS. */
  tags?: string[];
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
  description?: string;
  emotion?: CrewEmotion;
  source?: CrewSource;
  catalogId?: string;
  searchText?: string;
  suggestable?: boolean;
  isDefault?: boolean;
  enabled?: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
  tools?: string[];
  tags?: string[];
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
