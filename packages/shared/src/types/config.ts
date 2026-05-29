import type { ProviderId } from './provider.js';

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
}

export interface OrganizationConfig {
  name: string;
  contact?: string;
}
