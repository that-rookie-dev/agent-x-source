export type IntegrationCategory =
  | 'travel'
  | 'productivity'
  | 'communication'
  | 'finance'
  | 'shopping'
  | 'smart_home'
  | 'dev_ops'
  | 'custom';

export type IntegrationTrust = 'official' | 'verified' | 'community';

export type IntegrationAuthMode =
  | 'oauth'
  | 'sign_in_browser'
  | 'api_key_form'
  | 'none'
  | 'stdio'
  | 'env'
  | 'remote_url'
  | 'import_config';

export interface ConnectGuideStep {
  title: string;
  body: string;
  link?: string;
}

export type SetupPreflightCheckId =
  | 'node_available'
  | 'npx_available'
  | 'network_reachable'
  | 'oauth_client_configured'
  | 'oauth_env_configured'
  | 'mcp_handshake'
  | 'folder_readable'
  | 'folder_writable'
  | 'local_port_reachable'
  | 'redis_reachable'
  | 'postgres_reachable';

export type SetupWizardTemplate =
  | 'oauth_remote'
  | 'api_key'
  | 'stdio_none'
  | 'connection_string'
  | 'remote_url'
  | 'folder_sandbox'
  | 'package_sign_in'
  | 'custom';

export type SetupOsPermissionId = 'notifications' | 'folder_access' | 'local_network';

export interface ProviderSetupWizardSpec {
  template: SetupWizardTemplate;
  preflight: SetupPreflightCheckId[];
  osPermissions?: SetupOsPermissionId[];
  /** Hide Developer stdio tab for non-technical users (default true for lifestyle categories). */
  hideDeveloperTab?: boolean;
}

export interface SetupPreflightResult {
  id: SetupPreflightCheckId;
  ok: boolean;
  message: string;
  fixHint?: string;
}

export type IntegrationCatalogStatus = 'active' | 'candidate' | 'testing' | 'deprecated';

export interface IntegrationProvider {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  icon: string;
  website?: string;
  trust: IntegrationTrust;
  /** Lifecycle in the evaluation catalog. Defaults to active when omitted. */
  catalogStatus?: IntegrationCatalogStatus;
  /** npm package or remote endpoint label for verification scripts. */
  npmPackage?: string;
  /** Manual evaluation notes while testing candidates. */
  evaluationNotes?: string;
  server: {
    type: 'stdio' | 'remote';
    package?: string;
    command?: string;
    args?: string[];
    url?: string;
  };
  auth: {
    primary: IntegrationAuthMode;
    developer?: IntegrationAuthMode[];
    connectGuide?: ConnectGuideStep[];
    fields?: IntegrationAuthField[];
    oauth?: IntegrationOAuthConfig;
    /** Browser/package login via MCP tools after connect (e.g. booking_login). */
    packageSignIn?: {
      loginTool: string;
      statusTool?: string;
      progressTool?: string;
      label?: string;
    };
  };
  /** Per-provider setup wizard spec (inferred from auth when omitted). */
  setupWizard?: ProviderSetupWizardSpec;
  capabilities: {
    search: boolean;
    read: boolean;
    write: boolean;
    transact: boolean;
  };
  /** Store-facing capability bullets (modal). Auto-filled from catalog when omitted. */
  highlights?: string[];
  tools?: {
    autoExecute?: string[];
    alwaysConfirm?: string[];
  };
  /** When set, connection is blocked unless provider id is in the allowlist. */
  requiresAllowlist?: boolean;
}

export interface IntegrationOAuthConfig {
  /** RFC 8414 discovery URL. When omitted, derived from remote server URL or authorization server. */
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  /** Read client id from environment variable at runtime (e.g. AGENTX_LINEAR_OAUTH_CLIENT_ID). */
  clientIdEnv?: string;
  scopes?: string[];
  /** MCP resource indicator (RFC 8707) for remote MCP servers. */
  resource?: string;
  /** Redirect URI registered with the provider. Defaults to /api/integrations/oauth/callback on current host. */
  redirectPath?: string;
}

export interface IntegrationAuthField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
}

export type IntegrationConnectionStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

export interface IntegrationConnection {
  id: string;
  providerId: string;
  displayName: string;
  status: IntegrationConnectionStatus;
  authMode: IntegrationAuthMode;
  connectedAt: string;
  lastSyncAt?: string;
  error?: string;
  accountLabel?: string;
  toolCount?: number;
  enabled: boolean;
  stdio?: {
    command: string;
    args: string[];
    cwd?: string;
  };
  remote?: {
    url: string;
  };
}

export interface IntegrationConnectionSecrets {
  env?: Record<string, string>;
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    scope?: string;
  };
}

export interface IntegrationAuditEntry {
  id: string;
  connectionId: string;
  providerId: string;
  toolName: string;
  toolId: string;
  readonly: boolean;
  success: boolean;
  timestamp: string;
  error?: string;
  argsSummary?: string;
}

export interface IntegrationHealth {
  connectionId: string;
  providerId: string;
  status: IntegrationConnectionStatus;
  toolCount: number;
  error?: string;
  lastSyncAt?: string;
}

export interface ConnectIntegrationRequest {
  authMode?: IntegrationAuthMode;
  env?: Record<string, string>;
  displayName?: string;
  stdio?: {
    command: string;
    args?: string[];
    cwd?: string;
  };
  remote?: {
    url: string;
  };
}

export interface OAuthStartResponse {
  authUrl: string;
  state: string;
}

export type OAuthFlowStatus = 'pending' | 'completed' | 'failed' | 'expired';

export interface OAuthFlowResult {
  status: OAuthFlowStatus;
  connection?: IntegrationConnection;
  message?: string;
}

/** Structured preview shown before executing a write/transact integration tool. */
export interface IntegrationActionPreview {
  providerId: string;
  providerName: string;
  toolId: string;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  impact: string;
  parameters: Array<{ key: string; value: string; sensitive?: boolean }>;
  resultType?: 'generic' | 'issue' | 'calendar' | 'hotel' | 'message';
}

export interface IntegrationAnalytics {
  totalCalls: number;
  successRate: number;
  readonlyCalls: number;
  writeCalls: number;
  byProvider: Record<string, { calls: number; success: number; failures: number }>;
  recentErrors: Array<{ timestamp: string; providerId: string; toolName: string; error: string }>;
}

export interface McpImportServerEntry {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpImportConfig {
  mcpServers: Record<string, McpImportServerEntry>;
}

export interface IntegrationHubSettings {
  /** When non-empty, only these provider ids may be connected. */
  allowedProviderIds?: string[];
  /** Poll connected servers for health (default true). */
  healthPollingEnabled?: boolean;
  healthPollIntervalMs?: number;
  /** Optional HTTPS URL returning `{ "providers": IntegrationProvider[] }` to merge into the catalog. */
  catalogRemoteUrl?: string;
  /** Per-provider OAuth client ids (e.g. google-drive) when env vars are not used. */
  oauthClientIds?: Record<string, string>;
  /** Show candidate providers in the Integrations Hub UI (for manual evaluation). */
  showCandidateProviders?: boolean;
}

export type IntegrationSecretStorage = 'keychain' | 'dek_encrypted';

export interface IntegrationSecretRef {
  storage: IntegrationSecretStorage;
  connectionId: string;
}
