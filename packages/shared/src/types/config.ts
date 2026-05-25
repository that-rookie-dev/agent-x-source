import type { ProviderId } from './provider.js';

export interface AgentXConfig {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  timezone?: string; // IANA timezone (e.g. 'Asia/Kolkata'). Auto-detected if not set.
}

export interface ProviderSettings {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<string, ProviderCredentials>;
}

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  configured: boolean;
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
