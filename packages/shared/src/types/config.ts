import type { ProviderId, ReasoningEffortLevel } from './provider.js';
import type { RAGConfig } from './rag.js';
import type { PermissionRule } from './permission.js';
import type { NotificationChannelsConfig } from './channels.js';
import type { VoiceConfig } from './voice.js';

export type { NotificationChannelsConfig, NotificationChannelId, NotificationChannelStatus } from './channels.js';

export interface UserConfig {
  callsign: string;
}

export type CommunicationStyle = 'formal' | 'casual' | 'direct' | 'empathetic';
export type DecisionMakingStyle = 'conservative' | 'balanced' | 'aggressive';

export interface AgentPersonaConfig {
  name: string;
  description: string;
  communicationStyle: CommunicationStyle;
  decisionMaking: DecisionMakingStyle;
  domainContext: string;
  traits: string[];
}

/** Paid web search providers — BYOK only; DuckDuckGo is the free default. */
export type WebSearchPaidProviderId = 'brave' | 'exa' | 'tavily';

export interface WebSearchPaidProviderConfig {
  enabled: boolean;
  apiKey?: string;
}

export interface WebSearchToolsConfig {
  /** Open-source DuckDuckGo HTML search — enabled by default when unset. */
  duckduckgo?: { enabled?: boolean };
  brave?: WebSearchPaidProviderConfig;
  exa?: WebSearchPaidProviderConfig;
  tavily?: WebSearchPaidProviderConfig;
}

export interface ToolsConfig {
  webSearch?: WebSearchToolsConfig;
}

import type { RuntimeSettings } from '../runtime-settings.js';

export type { RuntimeSettings } from '../runtime-settings.js';

export interface AgentXConfig extends Record<string, unknown> {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  /** CPU, caching, and background worker tuning. Changes require restart. */
  runtime?: RuntimeSettings;
  timezone?: string; // IANA timezone (e.g. 'Asia/Kolkata'). Auto-detected if not set.
  user?: UserConfig;
  setupComplete?: boolean; // true after Mission Control wizard finishes
  rag?: RAGConfig;
  tools?: ToolsConfig;
  /** Outbound notification channels (Telegram, Slack, Email, Discord). */
  channels?: NotificationChannelsConfig;
  /** Optional strictly-local voice subsystem. Disabled unless configured. */
  voice?: VoiceConfig;
  localModel?: LocalModelConfig;
  featureRouting?: FeatureRoutingConfig;
  maxSubAgents?: number; // Maximum number of concurrent sub-agents (default: 5, max: 20)

  /** Maximum autonomous LLM↔tool cycles per turn (default: 20, increase for complex tasks) */
  maxSteps?: number;
  /** Maximum LLM retries on transient failures (default: 2, 0 = no retry) */
  maxRetries?: number;
  /** Maximum output tokens per LLM response (default: 8192, range: 256-32768) */
  maxOutputTokens?: number;
  /** Run shell commands in Docker sandbox for isolation (default: false) */
  useSandbox?: boolean;

  /** Optional PostgreSQL connection config. */
  postgres?: {
    connectionString?: string;
    poolSize?: number;
  };

  permissions?: Record<string, 'allow' | 'deny' | 'ask'>;
  agents?: Record<string, {
    model?: string;
    temperature?: number;
    systemPrompt?: string;
    deniedTools?: string[];
    permissions?: PermissionRule[];
  }>;
}

export interface DownloadedLocalModel {
  modelId: string;
  modelName: string;
  displayName?: string;
  downloadedAt: string;
  dtype?: 'q4' | 'q4f16' | 'fp32' | 'fp16' | 'int8';
}

export interface LocalModelConfig {
  enabled?: boolean;
  modelId?: string;
  modelName?: string;
  displayName?: string;
  cacheDir?: string;
  downloadedAt?: string;
  dtype?: 'q4' | 'q4f16' | 'fp32' | 'fp16' | 'int8';
  downloadedModels?: DownloadedLocalModel[];
}

export interface FeatureRoutingConfig {
  memoryExtraction?: 'cloud' | 'local';
  memoryConsolidation?: 'cloud' | 'local';
  embeddings?: 'cloud' | 'local';
}

export interface ProviderSettings {
  activeProvider: ProviderId;
  activeModel: string;
  /** Selected reasoning/thinking depth for the active model (when supported). */
  activeReasoningEffort?: ReasoningEffortLevel;
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

  /** Azure-specific resource name for Azure OpenAI deployments. */
  azureResourceName?: string;
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
