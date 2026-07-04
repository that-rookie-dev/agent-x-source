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
  OAuthStartResponse,
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
import { IntegrationConnectionManager } from './mcp/connection-manager.js';
import { OAuthPkceStore } from './oauth/pkce-flow.js';
import { expandStdioArgs } from './stdio-args.js';
import { formatStdioSpawnError, resolveStdioCommand } from '@agentx/shared';
import { parseIntegrationStructuredResult } from './integration-result.js';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerOAuthClient,
  tokenExpiresAt,
  tryResolveClientId,
} from './oauth/oauth-client.js';
import { resolveOAuthMetadata } from './oauth/discovery.js';

interface ActiveSession {
  connectionId: string;
  providerId: string;
  session: McpSession;
  tools: Array<{ mcpName: string; toolId: string; definition: ReturnType<typeof adaptMcpTools>[number] }>;
}

export class IntegrationHub {
  private readonly store: IntegrationConnectionStore;
  private readonly audit: IntegrationAuditLog;
  private readonly oauth = new OAuthPkceStore();
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly customProviders = new Map<string, IntegrationProvider>();
  private readonly connectionManager: IntegrationConnectionManager;
  private dek: Buffer | null = null;
  private getDek?: () => Buffer | null;
  private redirectBaseUrl: string;
  private settings: IntegrationHubSettings;

  constructor(options?: { baseDir?: string; getDek?: () => Buffer | null; redirectBaseUrl?: string }) {
    this.store = new IntegrationConnectionStore(options?.baseDir);
    this.audit = new IntegrationAuditLog(options?.baseDir);
    this.getDek = options?.getDek;
    this.redirectBaseUrl = options?.redirectBaseUrl ?? process.env['AGENTX_PUBLIC_URL'] ?? `http://127.0.0.1:${process.env['AGENTX_PORT'] ?? process.env['PORT'] ?? '3333'}`;
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
    await this.store.migrateLegacySecrets(this.currentDek());
  }

  setRedirectBaseUrl(url: string): void {
    this.redirectBaseUrl = url.replace(/\/$/, '');
  }

  private currentDek(): Buffer | null {
    return this.getDek?.() ?? this.dek ?? null;
  }

  private assertProviderAllowed(providerId: string): void {
    if (!isProviderAllowed(providerId)) {
      throw new Error(`Provider "${providerId}" is not allowed by enterprise policy.`);
    }
  }

  private oauthRedirectUri(): string {
    return `${this.redirectBaseUrl}/api/integrations/oauth/callback`;
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
    const next = saveIntegrationHubSettings(patch);
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
    if (tryResolveClientId(resolved)) return resolved;

    if (resolved.clientIdEnv) {
      throw new Error(
        `Set ${resolved.clientIdEnv} in the environment to enable browser sign-in for "${providerId}".`,
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
    const settings = getIntegrationHubSettings();
    saveIntegrationHubSettings({
      ...settings,
      oauthClientIds: { ...(settings.oauthClientIds ?? {}), [providerId]: clientId },
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
    return { authUrl, state: challenge.state };
  }

  async completeOAuth(state: string, code: string): Promise<IntegrationConnection> {
    const challenge = this.oauth.consume(state);
    if (!challenge) throw new Error('OAuth state expired or invalid');

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
    return this.syncConnection(connection.id);
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
      this.sessions.set(connectionId, {
        connectionId,
        providerId: connection.providerId,
        session,
        tools,
      });

      const updated = this.store.updateConnection(connectionId, {
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
        toolCount: adapted.length,
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
    for (const connection of this.store.listConnections()) {
      if (!connection.enabled) continue;
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
  }

  syncToToolkit(registry: ToolRegistry, executor: ToolExecutor): number {
    for (const prefix of integrationToolUnregisterPrefixes()) {
      registry.unregisterByPrefix(prefix);
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
    }
    let count = 0;
    for (const mapped of active.tools) {
      registry.register(mapped.definition);
      executor.registerHandler(mapped.definition.id, async (args, context) =>
        this.executeTool(connectionId, mapped.mcpName, args, context),
      );
      count += 1;
    }
    return count;
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
      const toolId = integrationToolId(connection.providerId, toolName);
      const structured = parseIntegrationStructuredResult(toolId, output);
      this.audit.append({
        connectionId,
        providerId: connection.providerId,
        toolName,
        toolId: parseIntegrationToolId(toolId)?.toolName ?? toolName,
        readonly,
        success: true,
        argsSummary: summarizeArgs(args),
      });
      return {
        success: true,
        output,
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
    const env = {
      ...(secrets.env ?? {}),
      ...(secrets.oauth?.accessToken ? { MCP_ACCESS_TOKEN: secrets.oauth.accessToken } : {}),
    };

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
      env: Object.keys(env).length > 0 ? env : undefined,
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
