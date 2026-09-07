import type { ProviderId, ReasoningEffortLevel } from './provider.js';
import type { RAGConfig } from './rag.js';
import type { PermissionRule } from './permission.js';
import type { NotificationChannelsConfig } from './channels.js';
import type { VoiceConfig } from './voice.js';
import type { HostConfig } from './host.js';

export type { NotificationChannelsConfig, NotificationChannelId, NotificationChannelStatus } from './channels.js';
export type { HostConfig } from './host.js';
export type { TelephonyConfig, TelephonyProviderId } from './telephony.js';

export const USER_HONORIFIC_PREFIXES = ['Mr.', 'Ms.', 'Mrs.', 'Miss', 'Dr.', 'Prof.', 'Mx.'] as const;
export type UserHonorificPrefix = (typeof USER_HONORIFIC_PREFIXES)[number];

export const USER_GENDERS = ['male', 'female', 'nonbinary', 'unspecified'] as const;
export type UserGender = (typeof USER_GENDERS)[number];

export const USER_GENDER_LABELS: Record<UserGender, string> = {
  male: 'Male (he/him)',
  female: 'Female (she/her)',
  nonbinary: 'Non-binary (they/them)',
  unspecified: 'Prefer not to say',
};

export interface UserConfig {
  /**
   * How Agent-X addresses the root user directly (dashboard, voice, WhatsApp self-chat).
   * Never used when talking to other people about the owner.
   */
  callsign: string;
  /**
   * Given names and nicknames Agent-X may use when referring to the owner to other
   * people (WhatsApp contacts, Telegram, email, etc.). Pick any of them at random.
   */
  names?: string[];
  /**
   * First public name — kept in sync with `names[0]` for older configs.
   * Prefer `names`.
   */
  name?: string;
  /** Honorific that may be paired with any public name for third parties (Mr., Dr., …). */
  prefix?: string;
  gender?: UserGender;
  /** Optional; only used when a task actually needs to contact the owner by email. */
  email?: string;
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
  /**
   * Host / public edge / VOIP. Disabled by default; public access is opt-in.
   * Tunnel + telephony secrets live here (encrypted at rest).
   */
  host?: HostConfig;
  localModel?: LocalModelConfig;
  featureRouting?: FeatureRoutingConfig;
  /** Runtime capability growth (Synthetic Intelligence). Default off. */
  syntheticIntelligence?: import('./capability.js').SyntheticIntelligenceConfig;
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

  /**
   * Observability settings (traces, logs, metrics).
   * The runtime config lives in the `observability.config` DB table and is
   * managed via the Developer Tab or the /api/observability/config endpoint.
   * This section is optional and only used for static config binding.
   */
  observability?: {
    /** Retention period in days (default: 30, range: 1-90). */
    retention_days?: number;
    /** Capture prompt/response content in spans (default: true). */
    capture_prompts?: boolean;
    /** Enable observability collection (default: true). */
    enabled?: boolean;
  };

  /** Developer mode settings. */
  developer?: {
    /** Whether developer mode is enabled; persists across app restarts and reinstalls. */
    devMode?: boolean;
  };

  /** Prime Agent adoption feature toggles (Settings → Advanced or config.json). */
  adoption?: import('./adoption-settings.js').AdoptionSettings;
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
  capabilityGeneration?: 'cloud' | 'local';
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
  /**
   * Wire protocol for custom provider profiles. Only meaningful when the
   * owning provider id is `custom`. Defaults to `openai-compatible` when
   * omitted. See {@link CustomApiType}.
   */
  apiType?: string;
  /** User-supplied model id for custom profiles whose endpoint may not list models. */
  modelId?: string;
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
