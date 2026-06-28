import type { ProviderId } from './provider.js';
import type { RAGConfig } from './rag.js';
import type { PermissionRule } from './permission.js';

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

export interface AgentXConfig {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  timezone?: string; // IANA timezone (e.g. 'Asia/Kolkata'). Auto-detected if not set.
  user?: UserConfig;
  setupComplete?: boolean; // true after Mission Control wizard finishes
  rag?: RAGConfig;
  tools?: ToolsConfig;
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

  permissions?: Record<string, 'allow' | 'deny' | 'ask'>;
  agents?: Record<string, {
    model?: string;
    temperature?: number;
    systemPrompt?: string;
    deniedTools?: string[];
    permissions?: PermissionRule[];
  }>;
}

export interface LocalModelConfig {
  enabled?: boolean;
  modelId?: string;
  modelName?: string;
  displayName?: string;
  cacheDir?: string;
  downloadedAt?: string;
}

export interface FeatureRoutingConfig {
  memoryDistillation?: 'cloud' | 'local';
  memoryExtraction?: 'cloud' | 'local';
  memoryConsolidation?: 'cloud' | 'local';
  embeddings?: 'cloud' | 'local';
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
