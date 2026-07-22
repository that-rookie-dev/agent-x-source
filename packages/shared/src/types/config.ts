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

/** All web search providers the agent can try (free + BYOK). */
export type WebSearchProviderId = 'duckduckgo' | WebSearchPaidProviderId;

export interface WebSearchPaidProviderConfig {
  enabled: boolean;
  /** Present only when the client is saving a new key (never returned from the API). */
  apiKey?: string;
  /**
   * Server → client: whether a key is stored (actual secret is never sent).
   * Client → server: set `false` to clear the stored key on save.
   */
  apiKeyConfigured?: boolean;
}

export interface WebSearchToolsConfig {
  /** Open-source DuckDuckGo HTML search — enabled by default when unset. */
  duckduckgo?: { enabled?: boolean };
  brave?: WebSearchPaidProviderConfig;
  exa?: WebSearchPaidProviderConfig;
  tavily?: WebSearchPaidProviderConfig;
  /**
   * Try-order for active providers. The agent uses the first ready tool;
   * if it returns no/insufficient hits, it falls through to the next.
   * Inactive / unconfigured providers are skipped at runtime.
   */
  providerOrder?: WebSearchProviderId[];
}

export interface ToolsConfig {
  webSearch?: WebSearchToolsConfig;
}

import type { PerformanceSettings } from '../performance-settings.js';

export type { PerformanceSettings } from '../performance-settings.js';
/** @deprecated Use PerformanceSettings */
export type { PerformanceSettings as RuntimeSettings } from '../performance-settings.js';

export interface AgentXConfig extends Record<string, unknown> {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  /**
   * Soft concurrency / resource profile (Settings → Performance).
   * Maps host CPU+RAM into LLM, tool, crew, background, and ONNX lanes.
   * Concurrency retunes live on save; ONNX threads / storage hydrate apply after restart.
   */
  performance?: PerformanceSettings;
  timezone?: string; // IANA timezone (e.g. 'Asia/Kolkata'). Auto-detected if not set.
  user?: UserConfig;
  setupComplete?: boolean; // true after Mission Control wizard finishes
  /**
   * Global Agent-X Workspace root. All chat sessions / tools are sandboxed here.
   * When unset, defaults to `{dataDir}/workspace` (no user permission required).
   */
  workspacePath?: string;
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
