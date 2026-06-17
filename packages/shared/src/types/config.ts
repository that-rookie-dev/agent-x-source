import type { ProviderId } from './provider.js';
import type { RAGConfig } from './rag.js';
import type { PermissionRule } from './permission.js';

export interface UserConfig {
  callsign: string;
}

export interface AgentXConfig {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  timezone?: string; // IANA timezone (e.g. 'Asia/Kolkata'). Auto-detected if not set.
  user?: UserConfig;
  setupComplete?: boolean; // true after Mission Control wizard finishes
  rag?: RAGConfig;
  maxSubAgents?: number; // Maximum number of concurrent sub-agents (default: 5, max: 20)
  permissions?: Record<string, 'allow' | 'deny' | 'ask'>;
  agents?: Record<string, {
    model?: string;
    temperature?: number;
    systemPrompt?: string;
    deniedTools?: string[];
    permissions?: PermissionRule[];
  }>;
}

export interface ProviderSettings {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<string, ProviderCredentials>;
}

export interface ProviderProfile {
  label: string;
  apiKey?: string;
  baseUrl?: string;
  createdAt?: string;
}

// Backwards-compatible provider credentials structure with
// optional multi-profile support.
export interface ProviderCredentials {
  // legacy single-key fields (kept for compatibility)
  apiKey?: string;
  baseUrl?: string;
  configured: boolean;

  // new multi-profile support
  activeProfile?: string;
  profiles?: Record<string, ProviderProfile>;
}

export interface UISettings {
  theme: 'dark' | 'light';
  showTokenBar: boolean;
  showTimers: boolean;
  animationSpeed: 'normal' | 'fast' | 'reduced';
  disabledTools?: string[];
}

export interface OrganizationConfig {
  name: string;
  contact?: string;
}
