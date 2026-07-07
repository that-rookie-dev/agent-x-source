import { randomUUID } from 'node:crypto';
import type {
  ConnectIntegrationRequest,
  IntegrationAnalytics,
  IntegrationConnection,
  IntegrationConnectionSecrets,
  IntegrationHealth,
  IntegrationHubSettings,
  IntegrationOAuthConfig,
  IntegrationProvider,
  OAuthFlowResult,
  OAuthStartResponse,
  SetupPreflightCheckId,
  SetupPreflightResult,
  ToolResult,
} from '@agentx/shared';
import { getLogger, assertHubOAuthReady, resolveProviderOAuthConfig } from '@agentx/shared';
import type { ToolExecutionContext } from '@agentx/shared';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { IntegrationAuditLog } from './audit-log.js';
import { IntegrationConnectionStore } from './connection-store.js';
import {
  getIntegrationProvider,
  getIntegrationHubSettings,
  getCatalogStats,
  isProviderAllowed,
  listAllProviders,
  loadIntegrationHubSettings,
  loadRemoteCatalog,
  saveIntegrationHubSettings,
} from './catalog/index.js';
import {
  integrationToolId,
  integrationToolUnregisterPrefixes,
  parseIntegrationToolId,
  isReadOnlyIntegrationTool,
} from './action-classifier.js';
import { adaptMcpTools } from './mcp/tool-adapter.js';
import { McpSession } from './mcp/client.js';
import { getProviderBridgeTools, type IntegrationBridgeTool } from './mcp/provider-bridge.js';
import { isMcpToolResultError } from './mcp/mcp-result.js';
import { enhanceGoogleMapsToolOutput } from './mcp/google-maps-output.js';
import {
  resolveThirdPartyAccess,
  resolveMentionedProviderAccess,
  type ThirdPartyTurnPolicy,
} from './third-party-access.js';
import { enrichConnectionAvailability } from './integration-tool-availability.js';
import { IntegrationConnectionManager } from './mcp/connection-manager.js';
import { OAuthPkceStore } from './oauth/pkce-flow.js';
import { expandStdioArgs } from './stdio-args.js';
import { formatStdioSpawnError, resolveStdioCommand } from '@agentx/shared';
import { parseIntegrationStructuredResult } from './integration-result.js';
import { resolveIntegrationDek } from './oauth/integration-dek.js';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerOAuthClient,
  tokenExpiresAt,
  tryResolveClientId,
} from './oauth/oauth-client.js';
import { resolveOAuthMetadata } from './oauth/discovery.js';
import {
  buildMcpStdioAuthEnv,
  formatMcpStdioAuthError,
  hasMcpStdioAuthCredentials,
  isMcpStdioAuthPending,
  MCP_STDIO_AUTH_PENDING_MESSAGE,
  resolveMcpStdioAuthCredentials,
  runMcpStdioAuthCommand,
} from './mcp-stdio-auth.js';
import {
  completeMcpStdioBrowserOAuth,
  getMcpStdioOAuthRedirectUri,
  McpStdioOAuthStore,
  startMcpStdioBrowserOAuth,
  usesNativeMcpStdioBrowserOAuth,
} from './mcp-stdio-oauth-flow.js';
import { runPreflightChecks, type PreflightContext } from './preflight.js';

interface ActiveSession {
  connectionId: string;
  providerId: string;
  session: McpSession;
  tools: Array<{ mcpName: string; toolId: string; definition: ReturnType<typeof adaptMcpTools>[number] }>;
}

export interface IntegrationTurnSnapshot {
  registeredCount: number;
  connected: Array<import('./integration-tool-availability.js').IntegrationConnectionRef>;
  unavailable: Array<{ providerId: string; name: string; error?: string }>;
}

interface StoredOAuthResult {
  status: 'completed' | 'failed';
  providerId: string;
  connectionId?: string;
  message?: string;
  createdAt: number;
}

export class IntegrationHub {
  private readonly store: IntegrationConnectionStore;
  private readonly audit: IntegrationAuditLog;
  private readonly oauth = new OAuthPkceStore();
  private readonly mcpStdioOAuth = new McpStdioOAuthStore();
  private readonly oauthResults = new Map<string, StoredOAuthResult>();
  /** States consumed by completeOAuth but not yet written to oauthResults (token exchange + sync). */
  private readonly oauthInFlight = new Set<string>();
  private readonly oauthResultTtlMs = 30 * 60 * 1000;
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly customProviders = new Map<string, IntegrationProvider>();
  private readonly connectionManager: IntegrationConnectionManager;
  private toolkitBridge: { registry: ToolRegistry; executor: ToolExecutor } | null = null;
  private dek: Buffer | null = null;
  private getDek?: () => Buffer | null;
  private redirectBaseUrl: string;
  private settings: IntegrationHubSettings;

  constructor(options?: { baseDir?: string; getDek?: () => Buffer | null; redirectBaseUrl?: string }) {
    this.store = new IntegrationConnectionStore(options?.baseDir);
    this.audit = new IntegrationAuditLog(options?.baseDir);
    this.getDek = options?.getDek;
    // Use "localhost" (not 127.0.0.1) — OAuth providers like Google enforce EXACT
    // redirect_uri string matching, and users register http://localhost:PORT/... per our docs.
    this.redirectBaseUrl = options?.redirectBaseUrl ?? process.env['AGENTX_PUBLIC_URL'] ?? `http://localhost:${process.env['AGENTX_PORT'] ?? process.env['PORT'] ?? '3333'}`;
    loadRemoteCatalog(options?.baseDir);
    this.settings = loadIntegrationHubSettings(options?.baseDir);
    this.connectionManager = new IntegrationConnectionManager(this, this.settings.healthPollIntervalMs ?? 5 * 60 * 1000);
    if (this.settings.healthPollingEnabled !== false) {
      this.connectionManager.start();
    }
  }

  setDek(dek: Buffer | null): void {
    this.dek = dek;
    if (dek) {
      void this.onDekAvailable();
    }
  }

  private async onDekAvailable(): Promise<void> {
    const dek = this.currentDek();
    await this.store.migrateLegacySecrets(dek);
    await this.store.migrateKeychainSecrets(dek);
  }

  setRedirectBaseUrl(url: string): void {
    this.redirectBaseUrl = url.replace(/\/$/, '');
  }

  /** Keep MCP tool registrations in sync when health polling restores sessions. */
  setToolkitBridge(registry: ToolRegistry, executor: ToolExecutor): void {
    this.toolkitBridge = { registry, executor };
  }

  private syncToolkitIfBridged(): number {
    if (!this.toolkitBridge) return 0;
    return this.syncToToolkit(this.toolkitBridge.registry, this.toolkitBridge.executor);
  }

  /**
   * Refresh MCP sessions and register integration tools before an agent turn.
   * Returns an optional prompt hint when the user message targets a connected provider.
   */
  async prepareForAgentTurn(
    registry: ToolRegistry,
    executor: ToolExecutor,
    userText = '',
  ): Promise<{ snapshot: IntegrationTurnSnapshot; promptHint?: string; accessPolicy?: ThirdPartyTurnPolicy }> {
    this.setToolkitBridge(registry, executor);

    for (const connection of this.store.listConnections()) {
      if (!connection.enabled) continue;
      if (this.sessions.has(connection.id) && connection.status === 'connected') continue;
      try {
        await this.syncConnection(connection.id);
      } catch (error) {
        getLogger().warn(
          'INTEGRATION_PRETURN_SYNC',
          `${connection.providerId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const registeredCount = this.syncToToolkit(registry, executor);
    const connected: IntegrationTurnSnapshot['connected'] = [];
    const unavailable: IntegrationTurnSnapshot['unavailable'] = [];

    const registeredIntegrationToolIds = registry.list().map((t) => t.id);

    for (const connection of this.store.listConnections()) {
      if (!connection.enabled) continue;
      const provider = this.resolveProvider(connection.providerId);
      const name = provider?.name ?? connection.displayName ?? connection.providerId;
      const active = this.sessions.get(connection.id);
      if (active) {
        connected.push(enrichConnectionAvailability({
          providerId: connection.providerId,
          name,
          toolCount: active.tools.length,
          handlersReady: executor ? this.connectionHandlersReady(connection.id, executor) : false,
        }, registeredIntegrationToolIds));
        continue;
      }
      unavailable.push({
        providerId: connection.providerId,
        name,
        error: connection.error ?? (connection.status !== 'connected' ? connection.status : undefined),
      });
    }

    const snapshot: IntegrationTurnSnapshot = { registeredCount, connected, unavailable };
    const { promptHint, policy } = this.buildIntegrationPromptHint(
      userText,
      snapshot,
      registeredIntegrationToolIds,
    );
    return promptHint || policy
      ? { snapshot, promptHint, accessPolicy: policy }
      : { snapshot };
  }

  private connectionHandlersReady(
    connectionId: string,
    executor: ToolExecutor,
  ): boolean {
    const active = this.sessions.get(connectionId);
    if (!active || active.tools.length === 0) return false;
    return active.tools.some((mapped) => executor.hasHandler(mapped.definition.id));
  }

  private buildIntegrationPromptHint(
    userText: string,
    snapshot: IntegrationTurnSnapshot,
    registeredIntegrationToolIds: string[],
  ): { promptHint?: string; policy?: ThirdPartyTurnPolicy } {
    const lower = userText.toLowerCase();
    if (!lower.trim()) return {};

    const catalog = this.listCatalog().map((p) => ({ id: p.id, name: p.name }));

    const readIntent =
      /\b(analys|analyz|read|open|summari|extract|review|inspect|tell me what|what you found|content of)\b/i.test(userText)
      || /\b(pdf|document|letter|spreadsheet|\.pdf)\b/i.test(lower);

    const resolved = resolveThirdPartyAccess({
      userText,
      snapshot,
      catalog,
      driveReadIntent: readIntent,
      registeredIntegrationToolIds,
    });
    if (resolved.promptHint || resolved.policy) {
      return { promptHint: resolved.promptHint, policy: resolved.policy };
    }

    const mentioned = resolveMentionedProviderAccess(
      userText,
      snapshot,
      registeredIntegrationToolIds,
    );
    if (mentioned) {
      return { promptHint: mentioned.promptHint, policy: mentioned.policy };
    }

    return {};
  }

  private currentDek(): Buffer | null {
    return resolveIntegrationDek(this.getDek?.() ?? this.dek ?? null);
  }

  private assertProviderAllowed(providerId: string): void {
    if (!isProviderAllowed(providerId)) {
      throw new Error(`Provider "${providerId}" is not allowed by enterprise policy.`);
    }
  }

  private oauthRedirectUri(): string {
    return `${this.redirectBaseUrl}/api/integrations/oauth/callback`;
  }

  /** Exact redirect URI users must register with their OAuth provider (e.g. Google Cloud Console). */
  getOAuthRedirectUri(): string {
    return this.oauthRedirectUri();
  }

  listCatalog(options?: { includeCandidates?: boolean }): IntegrationProvider[] {
    const includeCandidates = options?.includeCandidates ?? true;
    return listAllProviders({ includeCandidates });
  }

  getCatalogStats() {
    return getCatalogStats();
  }

  listConnections(): IntegrationConnection[] {
    return this.store.listConnections().map((connection) => {
      if (this.sessions.has(connection.id) && connection.status === 'syncing') {
        return { ...connection, status: 'connected' as const };
      }
      return connection;
    });
  }

  getProvider(providerId: string): IntegrationProvider | undefined {
    return this.resolveProvider(providerId);
  }

  private resolveProvider(providerId: string): IntegrationProvider | undefined {
    return getIntegrationProvider(providerId) ?? this.customProviders.get(providerId);
  }

  getSettings(): IntegrationHubSettings {
    return getIntegrationHubSettings();
  }

  updateSettings(patch: IntegrationHubSettings): IntegrationHubSettings {
    // Merge per-provider OAuth client ids so saving one provider's id never wipes others.
    const current = getIntegrationHubSettings();
    const merged: IntegrationHubSettings = patch.oauthClientIds
      ? { ...patch, oauthClientIds: { ...(current.oauthClientIds ?? {}), ...patch.oauthClientIds } }
      : patch;
    if (patch.oauthClientRedirectUris) {
      merged.oauthClientRedirectUris = {
        ...(current.oauthClientRedirectUris ?? {}),
        ...patch.oauthClientRedirectUris,
      };
    }
    const next = saveIntegrationHubSettings(merged);
    this.settings = next;
    if (typeof patch.healthPollIntervalMs === 'number') {
      this.connectionManager.setIntervalMs(patch.healthPollIntervalMs);
    }
    if (patch.healthPollingEnabled === false) {
      this.connectionManager.stop();
    } else     if (patch.healthPollingEnabled === true) {
      this.connectionManager.start();
    }
    return next;
  }

  private async ensureOAuthClientId(
    providerId: string,
    oauth: IntegrationOAuthConfig,
    redirectUri: string,
  ): Promise<IntegrationOAuthConfig> {
    const resolved = this.resolveOAuthConfig(providerId, oauth);

    // Static client id from catalog or env — not registered via dynamic client registration.
    if (oauth.clientId?.trim() || oauth.clientIdEnv) {
      if (tryResolveClientId(resolved)) return resolved;
      if (resolved.clientIdEnv) {
        throw new Error(
          `OAuth Client ID for "${providerId}" is not configured. Paste it in the setup wizard's System checks step, `
          + `or set ${resolved.clientIdEnv} in the environment.`,
        );
      }
    }

    const settings = getIntegrationHubSettings();
    const storedClientId = settings.oauthClientIds?.[providerId]?.trim();
    const storedRedirectUri = settings.oauthClientRedirectUris?.[providerId]?.trim();
    if (storedClientId && storedRedirectUri === redirectUri) {
      return { ...resolved, clientId: storedClientId };
    }

    if (storedClientId && storedRedirectUri && storedRedirectUri !== redirectUri) {
      getLogger().info(
        'INTEGRATION_OAUTH_REREGISTER',
        `${providerId}: redirect URI changed (${storedRedirectUri} → ${redirectUri}) — registering a new OAuth client`,
      );
    }

    const metadata = await resolveOAuthMetadata({
      discoveryUrl: resolved.discoveryUrl,
      authorizationUrl: resolved.authorizationUrl,
      tokenUrl: resolved.tokenUrl,
      remoteResourceUrl: resolved.discoveryUrl ? undefined : resolved.resource,
    });
    if (!metadata.registration_endpoint) {
      throw new Error(
        `Browser sign-in for "${providerId}" requires a registered OAuth client. `
        + 'This remote MCP server does not support automatic client registration.',
      );
    }

    const clientId = await registerOAuthClient(metadata.registration_endpoint, redirectUri);
    saveIntegrationHubSettings({
      ...settings,
      oauthClientIds: { ...(settings.oauthClientIds ?? {}), [providerId]: clientId },
      oauthClientRedirectUris: { ...(settings.oauthClientRedirectUris ?? {}), [providerId]: redirectUri },
    });
    return { ...resolved, clientId };
  }

  private resolveOAuthConfig(providerId: string, oauth: IntegrationOAuthConfig): IntegrationOAuthConfig {
    const clientId = getIntegrationHubSettings().oauthClientIds?.[providerId]?.trim();
    if (clientId) return { ...oauth, clientId };
    return oauth;
  }

  async connect(providerId: string, request: ConnectIntegrationRequest): Promise<IntegrationConnection> {
    const provider = this.resolveProvider(providerId);
    if (!provider) throw new Error(`Unknown integration provider "${providerId}"`);
    this.assertProviderAllowed(providerId);

    const authMode = request.authMode ?? provider.auth.primary;
    const secrets: IntegrationConnectionSecrets = {};
    if (request.env && Object.keys(request.env).length > 0) {
      secrets.env = request.env;
    }

    const stdio = request.stdio
      ? { command: request.stdio.command, args: expandStdioArgs(request.stdio.args ?? []), cwd: request.stdio.cwd }
      : (provider.server.type === 'stdio' && provider.server.command
        ? { command: provider.server.command, args: expandStdioArgs([...(provider.server.args ?? [])]) }
        : undefined);

    const connection = await this.store.upsertConnection(
      {
        providerId,
        displayName: request.displayName ?? provider.name,
        authMode,
        enabled: true,
        stdio,
        remote: request.remote,
        accountLabel: request.env?.['ACCOUNT_LABEL'] ?? request.env?.['GITHUB_USERNAME'],
      },
      Object.keys(secrets).length > 0 ? secrets : undefined,
      this.currentDek(),
    );

    if (isMcpStdioAuthPending(provider.auth.mcpStdioAuth, connection.id)) {
      resolveMcpStdioAuthCredentials(provider.auth.mcpStdioAuth!, secrets, connection.id);
      return this.store.updateConnection(connection.id, {
        status: 'disconnected',
        error: undefined,
      }) ?? connection;
    }

    return this.syncConnection(connection.id);
  }

  async connectCustom(provider: IntegrationProvider, request: ConnectIntegrationRequest): Promise<IntegrationConnection> {
    this.customProviders.set(provider.id, provider);
    this.assertProviderAllowed(provider.id);
    const secrets: IntegrationConnectionSecrets = {};
    if (request.env && Object.keys(request.env).length > 0) secrets.env = request.env;

    const connection = await this.store.upsertConnection(
      {
        providerId: provider.id,
        displayName: request.displayName ?? provider.name,
        authMode: request.authMode ?? provider.auth.primary,
        enabled: true,
        stdio: request.stdio ? { command: request.stdio.command, args: expandStdioArgs(request.stdio.args ?? []), cwd: request.stdio.cwd } : undefined,
        remote: request.remote,
      },
      Object.keys(secrets).length > 0 ? secrets : undefined,
      this.currentDek(),
    );
    return this.syncConnection(connection.id);
  }

  async startOAuth(providerId: string, remoteResourceUrl?: string): Promise<OAuthStartResponse> {
    const provider = this.resolveProvider(providerId);
    if (!provider) throw new Error(`Unknown integration provider "${providerId}"`);
    this.assertProviderAllowed(providerId);

    const remoteUrl = assertHubOAuthReady(provider, remoteResourceUrl);
    const oauthBase = resolveProviderOAuthConfig(provider, remoteUrl || remoteResourceUrl);
    const redirectUri = this.oauthRedirectUri();
    const oauth = await this.ensureOAuthClientId(providerId, oauthBase, redirectUri);
    const challenge = this.oauth.create(providerId, redirectUri, {
      remoteResourceUrl: remoteUrl || remoteResourceUrl || provider.server.url,
    });
    const authUrl = await buildAuthorizationUrl({
      oauth,
      challenge,
      redirectUri,
      remoteResourceUrl: remoteUrl || remoteResourceUrl || provider.server.url,
    });
    return { authUrl, state: challenge.state, redirectUri };
  }

  recordOAuthFailure(state: string, message: string): void {
    const trimmed = state.trim();
    if (!trimmed) return;
    const pending = this.oauth.peek(trimmed);
    this.oauthResults.set(trimmed, {
      status: 'failed',
      providerId: pending?.providerId ?? 'unknown',
      message,
      createdAt: Date.now(),
    });
    this.pruneOAuthResults();
  }

  getOAuthResult(state: string): OAuthFlowResult {
    const trimmed = state.trim();
    if (!trimmed) {
      return { status: 'expired', message: 'Missing OAuth state' };
    }

    const stored = this.oauthResults.get(trimmed);
    if (stored) {
      if (stored.status === 'completed' && stored.connectionId) {
        const connection = this.store.getConnection(stored.connectionId);
        return {
          status: 'completed',
          connection,
          message: connection ? `Connected to ${connection.displayName}` : undefined,
        };
      }
      return { status: 'failed', message: stored.message ?? 'OAuth sign-in failed' };
    }

    if (this.oauth.peek(trimmed)) {
      return { status: 'pending' };
    }

    if (this.oauthInFlight.has(trimmed)) {
      return { status: 'pending' };
    }

    return {
      status: 'expired',
      message: 'This sign-in link expired or was already used. Click "Sign in again" to restart.',
    };
  }

  private recordOAuthSuccess(state: string, providerId: string, connectionId: string): void {
    this.oauthResults.set(state, {
      status: 'completed',
      providerId,
      connectionId,
      createdAt: Date.now(),
    });
    this.pruneOAuthResults();
  }

  private pruneOAuthResults(): void {
    const now = Date.now();
    for (const [state, result] of this.oauthResults.entries()) {
      if (now - result.createdAt > this.oauthResultTtlMs) {
        this.oauthResults.delete(state);
      }
    }
  }

  async completeOAuth(state: string, code: string): Promise<IntegrationConnection> {
    const challenge = this.oauth.consume(state);
    if (!challenge) {
      throw new Error('This sign-in link expired or was already used. Return to Agent-X and click "Sign in again" to restart.');
    }

    this.oauthInFlight.add(state);
    try {
      const provider = this.resolveProvider(challenge.providerId);
      if (!provider) {
        throw new Error(`OAuth is not configured for provider "${challenge.providerId}"`);
      }

      const remoteUrl = challenge.remoteResourceUrl ?? provider.server.url;
      const oauthBase = resolveProviderOAuthConfig(provider, remoteUrl);
      const oauth = this.resolveOAuthConfig(challenge.providerId, oauthBase);
      if (!tryResolveClientId(oauth)) {
        throw new Error('OAuth client id missing — restart the sign-in flow.');
      }

      const tokenResponse = await exchangeAuthorizationCode({
        oauth,
        challenge,
        code,
        redirectUri: challenge.redirectUri,
        remoteResourceUrl: remoteUrl,
      });

      const connection = await this.store.upsertConnection(
        {
          providerId: challenge.providerId,
          displayName: provider.name,
          authMode: 'oauth',
          enabled: true,
          accountLabel: 'OAuth connected',
          remote: challenge.remoteResourceUrl ? { url: challenge.remoteResourceUrl } : provider.server.url ? { url: provider.server.url } : undefined,
        },
        {
          oauth: {
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token,
            expiresAt: tokenExpiresAt(tokenResponse.expires_in),
            scope: tokenResponse.scope,
          },
        },
        this.currentDek(),
      );
      const synced = await this.syncConnection(connection.id);
      this.recordOAuthSuccess(state, challenge.providerId, synced.id);
      return synced;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordOAuthFailure(state, message);
      throw error;
    } finally {
      this.oauthInFlight.delete(state);
    }
  }

  async preflightProvider(
    providerId: string,
    checkIds?: SetupPreflightCheckId[],
    context?: PreflightContext,
  ): Promise<SetupPreflightResult[]> {
    const provider = this.resolveProvider(providerId);
    if (!provider) throw new Error(`Unknown integration provider "${providerId}"`);
    const checks = checkIds ?? provider.setupWizard?.preflight ?? ['network_reachable'];
    return runPreflightChecks(provider, checks, context);
  }

  /** Dry-run MCP connect (list tools) without persisting a connection. */
  async probeConnection(
    providerId: string,
    request: ConnectIntegrationRequest,
  ): Promise<{ ok: boolean; toolCount: number; toolNames: string[]; error?: string }> {
    const provider = this.resolveProvider(providerId);
    if (!provider) throw new Error(`Unknown integration provider "${providerId}"`);

    const stdio = request.stdio
      ? { command: request.stdio.command, args: expandStdioArgs(request.stdio.args ?? []), cwd: request.stdio.cwd }
      : (provider.server.type === 'stdio' && provider.server.command
        ? { command: provider.server.command, args: expandStdioArgs([...(provider.server.args ?? [])]) }
        : undefined);

    const connection: IntegrationConnection = {
      id: `probe-${randomUUID()}`,
      providerId,
      displayName: request.displayName ?? provider.name,
      authMode: request.authMode ?? provider.auth.primary,
      status: 'syncing',
      connectedAt: new Date().toISOString(),
      enabled: true,
      stdio,
      remote: request.remote ?? (provider.server.type === 'remote' && provider.server.url ? { url: provider.server.url } : undefined),
    };

    const env = request.env ?? {};
    let session: McpSession | null = null;
    try {
      if (connection.remote?.url) {
        session = await McpSession.connectRemote({
          url: connection.remote.url,
          headers: env.MCP_ACCESS_TOKEN || env.access_token
            ? { Authorization: `Bearer ${env.MCP_ACCESS_TOKEN ?? env.access_token}` }
            : undefined,
          transport: 'streamable-http',
        });
      } else if (stdio) {
        session = await McpSession.connectStdio({
          command: resolveStdioCommand(stdio.command),
          args: stdio.args,
          cwd: stdio.cwd,
          env,
        });
      } else {
        throw new Error('No stdio command or remote URL configured');
      }
      const listed = await session.listTools();
      return {
        ok: listed.length > 0,
        toolCount: listed.length,
        toolNames: listed.slice(0, 12).map((tool) => tool.name),
      };
    } catch (error) {
      const message = formatStdioSpawnError(error, stdio?.command ?? provider.server.command);
      return { ok: false, toolCount: 0, toolNames: [], error: message };
    } finally {
      await session?.close();
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.closeSession(connectionId);
    await this.store.removeConnection(connectionId);
  }

  async syncConnection(connectionId: string): Promise<IntegrationConnection> {
    const connection = this.store.getConnection(connectionId);
    if (!connection) throw new Error(`Connection "${connectionId}" not found`);
    const provider = this.resolveProvider(connection.providerId);
    if (!provider) throw new Error(`Provider "${connection.providerId}" not found`);

    if (isMcpStdioAuthPending(provider.auth.mcpStdioAuth, connectionId)) {
      return this.store.updateConnection(connectionId, {
        status: 'disconnected',
        error: MCP_STDIO_AUTH_PENDING_MESSAGE,
      }) ?? connection;
    }

    this.store.updateConnection(connectionId, { status: 'syncing', error: undefined });

    try {
      await this.closeSession(connectionId);
      await this.ensureFreshOAuthToken(connectionId);
      const session = await this.openSession(connection, provider);
      const listed = await session.listTools();
      const adapted = adaptMcpTools(provider, listed);
      const tools = listed.map((tool, index) => ({
        mcpName: tool.name,
        toolId: adapted[index]!.id,
        definition: adapted[index]!,
      }));
      for (const bridge of getProviderBridgeTools(provider)) {
        tools.push({
          mcpName: bridge.mcpName,
          toolId: bridge.definition.id,
          definition: bridge.definition,
        });
      }
      this.sessions.set(connectionId, {
        connectionId,
        providerId: connection.providerId,
        session,
        tools,
      });

      const updated = this.store.updateConnection(connectionId, {
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
        toolCount: tools.length,
        error: undefined,
      });
      return updated ?? connection;
    } catch (error) {
      const stdioCommand = connection.stdio?.command ?? provider.server.command;
      const message = formatStdioSpawnError(error, stdioCommand);
      getLogger().error('INTEGRATION_SYNC_FAILED', { connectionId, error: message });
      const updated = this.store.updateConnection(connectionId, {
        status: 'error',
        error: message,
      });
      return updated ?? connection;
    }
  }

  async restoreAll(): Promise<void> {
    await this.store.migrateLegacySecrets(this.currentDek());
    await this.store.migrateKeychainSecrets(this.currentDek());
    for (const connection of this.store.listConnections()) {
      if (!connection.enabled) continue;
      const provider = this.resolveProvider(connection.providerId);
      if (provider && isMcpStdioAuthPending(provider.auth.mcpStdioAuth, connection.id)) continue;
      try {
        await this.syncConnection(connection.id);
      } catch (error) {
        getLogger().warn('INTEGRATION_RESTORE_FAILED', error instanceof Error ? error.message : String(error));
      }
    }
  }

  async maintainConnections(): Promise<void> {
    for (const connection of this.store.listConnections()) {
      if (!connection.enabled) continue;
      const provider = this.resolveProvider(connection.providerId);
      if (provider && isMcpStdioAuthPending(provider.auth.mcpStdioAuth, connection.id)) {
        if (connection.status === 'error') {
          this.store.updateConnection(connection.id, {
            status: 'disconnected',
            error: MCP_STDIO_AUTH_PENDING_MESSAGE,
          });
        }
        continue;
      }
      try {
        if (connection.status === 'error') {
          await this.syncConnection(connection.id);
          continue;
        }
        const active = this.sessions.get(connection.id);
        if (!active) {
          await this.syncConnection(connection.id);
          continue;
        }
        await active.session.listTools();
        this.store.updateConnection(connection.id, { lastSyncAt: new Date().toISOString(), status: 'connected', error: undefined });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        getLogger().warn('INTEGRATION_HEALTH_CHECK_FAILED', message);
        this.store.updateConnection(connection.id, { status: 'error', error: message });
        await this.closeSession(connection.id);
      }
    }
    this.syncToolkitIfBridged();
  }

  syncToToolkit(registry: ToolRegistry, executor: ToolExecutor): number {
    for (const prefix of integrationToolUnregisterPrefixes()) {
      registry.unregisterByPrefix(prefix);
      executor.unregisterHandlersByPrefix(prefix);
    }
    let registered = 0;
    for (const connection of this.store.listConnections()) {
      registered += this.registerConnectionTools(connection.id, registry, executor);
    }
    return registered;
  }

  registerConnectionTools(connectionId: string, registry: ToolRegistry, executor: ToolExecutor): number {
    const active = this.sessions.get(connectionId);
    if (!active) return 0;

    for (const prefix of integrationToolUnregisterPrefixes(active.providerId)) {
      registry.unregisterByPrefix(prefix);
      executor.unregisterHandlersByPrefix(prefix);
    }
    const provider = this.resolveProvider(active.providerId);
    const bridgeNames = new Set(
      provider ? getProviderBridgeTools(provider).map((bridge) => bridge.mcpName) : [],
    );
    let count = 0;
    for (const mapped of active.tools) {
      registry.register(mapped.definition);
      if (bridgeNames.has(mapped.mcpName)) {
        const bridge = getProviderBridgeTools(provider!).find((entry) => entry.mcpName === mapped.mcpName);
        if (bridge) {
          executor.registerHandler(mapped.definition.id, async (args, context) =>
            this.executeBridgeTool(connectionId, bridge, args, context),
          );
          count += 1;
          continue;
        }
      }
      executor.registerHandler(mapped.definition.id, async (args, context) =>
        this.executeTool(connectionId, mapped.mcpName, args, context),
      );
      count += 1;
    }
    return count;
  }

  private async executeBridgeTool(
    connectionId: string,
    bridge: IntegrationBridgeTool,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const sessionReady = await this.ensureActiveSession(connectionId);
    if (!sessionReady.ok) return sessionReady.result;

    const connection = sessionReady.connection;
    const active = this.sessions.get(connectionId)!;
    const provider = this.resolveProvider(connection.providerId);
    const readonly = isReadOnlyIntegrationTool(bridge.mcpName, provider);

    try {
      await this.ensureFreshOAuthToken(connectionId);
      const result = await bridge.execute(active.session, args);
      this.audit.append({
        connectionId,
        providerId: connection.providerId,
        toolName: bridge.mcpName,
        toolId: bridge.mcpName,
        readonly,
        success: result.success,
        argsSummary: summarizeArgs(args),
        error: result.success ? undefined : result.error ?? result.output,
      });
      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          providerId: connection.providerId,
          toolName: bridge.mcpName,
          readonly,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.audit.append({
        connectionId,
        providerId: connection.providerId,
        toolName: bridge.mcpName,
        toolId: bridge.mcpName,
        readonly,
        success: false,
        argsSummary: summarizeArgs(args),
        error: message,
      });
      return { success: false, output: message, error: 'INTEGRATION_TOOL_FAILED' };
    }
  }

  async executeTool(
    connectionId: string,
    toolName: string,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const sessionReady = await this.ensureActiveSession(connectionId);
    if (!sessionReady.ok) return sessionReady.result;

    const connection = sessionReady.connection;
    const active = this.sessions.get(connectionId)!;
    const provider = this.resolveProvider(connection.providerId);
    if (!provider) {
      return { success: false, output: 'Integration is not connected', error: 'NOT_CONNECTED' };
    }

    const readonly = isReadOnlyIntegrationTool(toolName, provider);
    try {
      await this.ensureFreshOAuthToken(connectionId);
      const result = await active.session.callTool(toolName, args);
      let output = formatMcpToolResult(result);
      output = this.clarifyPackageSignInOutput(provider, toolName, output);
      if (connection.providerId === 'google-maps') {
        output = enhanceGoogleMapsToolOutput(toolName, output);
      }
      const failed = isMcpToolResultError(result, output);
      const toolId = integrationToolId(connection.providerId, toolName);
      const structured = parseIntegrationStructuredResult(toolId, output);
      this.audit.append({
        connectionId,
        providerId: connection.providerId,
        toolName,
        toolId: parseIntegrationToolId(toolId)?.toolName ?? toolName,
        readonly,
        success: !failed,
        argsSummary: summarizeArgs(args),
        error: failed ? output.slice(0, 500) : undefined,
      });
      return {
        success: !failed,
        output,
        error: failed ? 'INTEGRATION_TOOL_FAILED' : undefined,
        metadata: {
          providerId: connection.providerId,
          toolName,
          readonly,
          integrationStructured: structured ?? undefined,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.audit.append({
        connectionId,
        providerId: connection.providerId,
        toolName,
        toolId: toolName,
        readonly,
        success: false,
        argsSummary: summarizeArgs(args),
        error: message,
      });
      const clarified = provider ? this.clarifyPackageSignInOutput(provider, toolName, message) : message;
      return { success: false, output: clarified, error: 'INTEGRATION_TOOL_FAILED' };
    }
  }

  private clarifyPackageSignInOutput(provider: IntegrationProvider, toolName: string, output: string): string {
    const signIn = provider.auth.packageSignIn;
    if (!signIn) return output;
    const lower = output.toLowerCase();
    if (!lower.includes('not connected') && !lower.includes('not logged') && !lower.includes('not signed')) {
      return output;
    }
    const label = signIn.label ?? provider.name;
    const loginTool = signIn.loginTool;
    const isAuthTool = toolName === loginTool || toolName === signIn.statusTool || toolName === signIn.progressTool;
    if (!isAuthTool && !lower.includes('not connected')) return output;
    return [
      `${label} account is not signed in (MCP server is connected).`,
      `Sign in via MCP Store → Installed → ${provider.name} → Sign in to ${label}.`,
      `Raw response: ${output}`,
    ].join('\n');
  }

  /** Run the MCP package's native OAuth auth subcommand (e.g. Google Drive `auth`). */
  async runMcpStdioAuth(connectionId: string): Promise<{ success: boolean; output: string }> {
    const connection = this.store.getConnection(connectionId);
    if (!connection) {
      return { success: false, output: 'Integration is not connected' };
    }
    const provider = this.resolveProvider(connection.providerId);
    const config = provider?.auth.mcpStdioAuth;
    if (!provider || !config) {
      return { success: false, output: 'This integration does not support MCP stdio auth' };
    }

    if (usesNativeMcpStdioBrowserOAuth(config)) {
      return {
        success: false,
        output: 'This integration uses Agent-X browser sign-in. Use startMcpStdioBrowserOAuth instead.',
      };
    }

    const secrets = await this.store.getSecrets(connectionId, this.currentDek());
    const resolved = resolveMcpStdioAuthCredentials(config, secrets, connectionId);
    if (!resolved) {
      return {
        success: false,
        output: 'OAuth Client ID and Client Secret are required. Re-open the setup wizard and enter both credentials.',
      };
    }

    const env = buildMcpStdioAuthEnv(config, connectionId);
    const result = await runMcpStdioAuthCommand(provider, config, env);
    if (result.success) {
      await this.syncConnection(connectionId);
      return result;
    }
    return {
      success: false,
      output: formatMcpStdioAuthError(result.output, provider.id),
    };
  }

  /** Gmail and other web-format MCP integrations: browser OAuth via Agent-X (no port-3000 helper). */
  async startMcpStdioBrowserOAuth(connectionId: string): Promise<{ authUrl: string; state: string; redirectUri: string }> {
    const connection = this.store.getConnection(connectionId);
    if (!connection) {
      throw new Error('Integration is not connected');
    }
    const provider = this.resolveProvider(connection.providerId);
    const config = provider?.auth.mcpStdioAuth;
    if (!provider || !config) {
      throw new Error('This integration does not support MCP stdio auth');
    }
    if (!usesNativeMcpStdioBrowserOAuth(config)) {
      throw new Error('This integration uses the MCP package auth helper — use runMcpStdioAuth instead.');
    }

    const secrets = await this.store.getSecrets(connectionId, this.currentDek());
    return startMcpStdioBrowserOAuth(this.mcpStdioOAuth, {
      connectionId,
      provider,
      config,
      redirectBaseUrl: this.redirectBaseUrl,
      secrets,
    });
  }

  getMcpStdioOAuthRedirectUri(providerId: string): string {
    const provider = this.resolveProvider(providerId);
    const config = provider?.auth.mcpStdioAuth;
    if (!config) {
      return `${this.redirectBaseUrl}/oauth2callback`;
    }
    return getMcpStdioOAuthRedirectUri(this.redirectBaseUrl, config);
  }

  getMcpStdioOAuthResult(state: string): OAuthFlowResult {
    return this.mcpStdioOAuth.getResult(state);
  }

  recordMcpStdioOAuthFailure(state: string, message: string): void {
    const pending = this.mcpStdioOAuth.peek(state);
    if (!pending) return;
    this.mcpStdioOAuth.recordFailure(state, pending.connectionId, pending.providerId, message);
  }

  async completeMcpStdioBrowserOAuth(state: string, code: string): Promise<IntegrationConnection> {
    const pending = this.mcpStdioOAuth.peek(state);
    if (!pending) {
      throw new Error('Sign-in session expired or invalid — click Sign in again.');
    }
    this.mcpStdioOAuth.markInFlight(state);
    try {
      const { connectionId } = await completeMcpStdioBrowserOAuth(this.mcpStdioOAuth, state, code);
      return await this.syncConnection(connectionId);
    } finally {
      this.mcpStdioOAuth.clearInFlight(state);
    }
  }

  getMcpStdioAuthStatus(connectionId: string): { signedIn: boolean; message?: string } {
    const connection = this.store.getConnection(connectionId);
    if (!connection) return { signedIn: false, message: 'Not connected' };
    const provider = this.resolveProvider(connection.providerId);
    const config = provider?.auth.mcpStdioAuth;
    if (!config) return { signedIn: false, message: 'Not applicable' };
    const signedIn = hasMcpStdioAuthCredentials(config, connectionId);
    return signedIn
      ? { signedIn: true }
      : { signedIn: false, message: MCP_STDIO_AUTH_PENDING_MESSAGE };
  }

  /** Run an MCP tool from the MCP Store (ensures session is open; no chat permission gate). */
  async runStoreTool(
    connectionId: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    const sessionReady = await this.ensureActiveSession(connectionId);
    if (!sessionReady.ok) return sessionReady.result;

    return this.executeTool(connectionId, toolName, args, {
      sessionId: 'mcp-store',
      scopePath: '*',
      timeout: 600_000,
      mode: 'agent',
    });
  }

  getHealth(connectionId: string): IntegrationHealth | undefined {
    const connection = this.store.getConnection(connectionId);
    if (!connection) return undefined;
    return {
      connectionId,
      providerId: connection.providerId,
      status: connection.status,
      toolCount: connection.toolCount ?? 0,
      error: connection.error,
      lastSyncAt: connection.lastSyncAt,
    };
  }

  getAuditTail(limit = 100) {
    return this.audit.tail(limit);
  }

  async readIntegrationResource(connectionId: string, uri: string): Promise<unknown> {
    const active = this.sessions.get(connectionId);
    const connection = this.store.getConnection(connectionId);
    if (!active || !connection) {
      throw new Error(`Connection "${connectionId}" is not active`);
    }
    await this.ensureFreshOAuthToken(connectionId);
    return active.session.readResource(uri);
  }

  getAnalytics(): IntegrationAnalytics {
    const entries = this.audit.tail(5000);
    const byProvider: IntegrationAnalytics['byProvider'] = {};
    let success = 0;
    let readonlyCalls = 0;
    let writeCalls = 0;
    for (const entry of entries) {
      if (!byProvider[entry.providerId]) {
        byProvider[entry.providerId] = { calls: 0, success: 0, failures: 0 };
      }
      const bucket = byProvider[entry.providerId]!;
      bucket.calls += 1;
      if (entry.success) {
        bucket.success += 1;
        success += 1;
      } else {
        bucket.failures += 1;
      }
      if (entry.readonly) readonlyCalls += 1;
      else writeCalls += 1;
    }
    const recentErrors = entries
      .filter((entry) => !entry.success && entry.error)
      .slice(-20)
      .map((entry) => ({
        timestamp: entry.timestamp,
        providerId: entry.providerId,
        toolName: entry.toolName,
        error: entry.error!,
      }));
    const totalCalls = entries.length;
    return {
      totalCalls,
      successRate: totalCalls > 0 ? success / totalCalls : 1,
      readonlyCalls,
      writeCalls,
      byProvider,
      recentErrors,
    };
  }

  async dispose(): Promise<void> {
    this.connectionManager.stop();
    for (const connectionId of [...this.sessions.keys()]) {
      await this.closeSession(connectionId);
    }
  }

  private async ensureActiveSession(
    connectionId: string,
  ): Promise<
    | { ok: true; connection: IntegrationConnection }
    | { ok: false; result: ToolResult }
  > {
    let connection = this.store.getConnection(connectionId);
    if (!connection) {
      return {
        ok: false,
        result: { success: false, output: 'Integration is not connected', error: 'NOT_CONNECTED' },
      };
    }

    if (!this.sessions.has(connectionId)) {
      try {
        connection = await this.syncConnection(connectionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, result: { success: false, output: message, error: 'NOT_CONNECTED' } };
      }
    }

    if (!this.sessions.has(connectionId)) {
      const message = connection.error?.trim()
        || `MCP server is not running (status: ${connection.status}). Use Sync on the provider card, then try sign-in again.`;
      return { ok: false, result: { success: false, output: message, error: 'NOT_CONNECTED' } };
    }

    return { ok: true, connection };
  }

  private async ensureFreshOAuthToken(connectionId: string): Promise<void> {
    const connection = this.store.getConnection(connectionId);
    if (!connection) return;
    const provider = this.resolveProvider(connection.providerId);
    if (!provider) return;

    const remoteUrl = connection.remote?.url ?? provider.server.url;
    const oauthBase = resolveProviderOAuthConfig(provider, remoteUrl);
    if (!provider.auth.oauth && provider.auth.primary !== 'oauth' && provider.auth.primary !== 'sign_in_browser') {
      return;
    }

    const secrets = await this.store.getSecrets(connectionId, this.currentDek());
    const oauth = secrets?.oauth;
    if (!oauth?.refreshToken) return;
    if (oauth.expiresAt && new Date(oauth.expiresAt).getTime() > Date.now() + 60_000) return;

    const refreshed = await refreshAccessToken({
      oauth: this.resolveOAuthConfig(connection.providerId, oauthBase),
      refreshToken: oauth.refreshToken,
      remoteResourceUrl: remoteUrl,
    });
    await this.store.upsertConnection(
      {
        id: connection.id,
        providerId: connection.providerId,
        displayName: connection.displayName,
        authMode: connection.authMode,
        enabled: connection.enabled,
        stdio: connection.stdio,
        remote: connection.remote,
        accountLabel: connection.accountLabel,
      },
      {
        ...secrets,
        oauth: {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? oauth.refreshToken,
          expiresAt: tokenExpiresAt(refreshed.expires_in),
          scope: refreshed.scope ?? oauth.scope,
        },
      },
      this.currentDek(),
    );
  }

  private async openSession(connection: IntegrationConnection, provider: IntegrationProvider): Promise<McpSession> {
    const secrets = (await this.store.getSecrets(connection.id, this.currentDek())) ?? {};
    const env: Record<string, string> = { ...(secrets.env ?? {}) };

    const mcpAuth = provider.auth.mcpStdioAuth;
    if (mcpAuth) {
      resolveMcpStdioAuthCredentials(mcpAuth, secrets, connection.id);
      Object.assign(env, buildMcpStdioAuthEnv(mcpAuth, connection.id));
    } else if (secrets.oauth?.accessToken) {
      env.MCP_ACCESS_TOKEN = secrets.oauth.accessToken;
    }

    if (connection.remote?.url) {
      const headers: Record<string, string> = {};
      if (secrets.oauth?.accessToken) {
        headers.Authorization = `Bearer ${secrets.oauth.accessToken}`;
      }
      return McpSession.connectRemote({
        url: connection.remote.url,
        headers,
        transport: 'streamable-http',
      });
    }

    const stdio = connection.stdio ?? {
      command: provider.server.command ?? 'npx',
      args: expandStdioArgs(provider.server.args ?? []),
    };

    return McpSession.connectStdio({
      command: resolveStdioCommand(stdio.command),
      args: stdio.args,
      cwd: stdio.cwd,
      env,
    });
  }

  private async closeSession(connectionId: string): Promise<void> {
    const active = this.sessions.get(connectionId);
    if (!active) return;
    await active.session.close();
    this.sessions.delete(connectionId);
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).slice(0, 6);
  return keys.map((key) => `${key}=${String(args[key]).slice(0, 40)}`).join(', ');
}

function formatMcpToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return String(result);
  const payload = result as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown; isError?: boolean };
  if (payload.structuredContent) {
    return JSON.stringify(payload.structuredContent, null, 2);
  }
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((item) => item.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim() || JSON.stringify(payload, null, 2);
  }
  return JSON.stringify(payload, null, 2);
}

export function createCustomProvider(displayName: string): IntegrationProvider {
  return {
    id: `custom-${randomUUID().slice(0, 8)}`,
    name: displayName || 'Custom MCP Server',
    category: 'custom',
    description: 'User-defined MCP server connection',
    icon: 'hub',
    trust: 'community',
    server: { type: 'stdio', command: 'npx', args: [] },
    auth: { primary: 'stdio', developer: ['stdio', 'env', 'remote_url', 'import_config'] },
    capabilities: { search: true, read: true, write: true, transact: true },
  };
}
