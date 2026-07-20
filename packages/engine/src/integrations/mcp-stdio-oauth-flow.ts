import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IntegrationMcpStdioAuth, IntegrationProvider, OAuthFlowResult } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import {
  getMcpStdioAuthPaths,
  resolveMcpStdioAuthCredentials,
  writeGoogleOAuthKeysFile,
} from './mcp-stdio-auth.js';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

export interface McpStdioOAuthPending {
  state: string;
  connectionId: string;
  providerId: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  config: IntegrationMcpStdioAuth;
  createdAt: number;
}

interface StoredMcpStdioOAuthResult {
  status: 'completed' | 'failed';
  connectionId: string;
  providerId: string;
  message?: string;
  createdAt: number;
}

export function usesNativeMcpStdioBrowserOAuth(config: IntegrationMcpStdioAuth): boolean {
  return config.oauthKeysFormat === 'web';
}

export function getMcpStdioOAuthRedirectUri(
  redirectBaseUrl: string,
  config: IntegrationMcpStdioAuth,
): string {
  const path = config.redirectPath ?? '/oauth2callback';
  const base = redirectBaseUrl.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveMcpStdioOAuthScopes(config: IntegrationMcpStdioAuth): string[] {
  if (config.scopes?.length) return config.scopes;
  return GMAIL_SCOPES;
}

export class McpStdioOAuthStore {
  private pending = new Map<string, McpStdioOAuthPending>();
  private results = new Map<string, StoredMcpStdioOAuthResult>();
  private inFlight = new Set<string>();
  private readonly ttlMs = 30 * 60 * 1000;

  create(pending: Omit<McpStdioOAuthPending, 'state' | 'createdAt'>): McpStdioOAuthPending {
    const state = randomBytes(16).toString('hex');
    const entry: McpStdioOAuthPending = { ...pending, state, createdAt: Date.now() };
    this.pending.set(state, entry);
    this.prune();
    return entry;
  }

  peek(state: string): McpStdioOAuthPending | undefined {
    const entry = this.pending.get(state);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.pending.delete(state);
      return undefined;
    }
    return entry;
  }

  consume(state: string): McpStdioOAuthPending | undefined {
    const entry = this.peek(state);
    if (!entry) return undefined;
    this.pending.delete(state);
    return entry;
  }

  markInFlight(state: string): void {
    this.inFlight.add(state);
  }

  clearInFlight(state: string): void {
    this.inFlight.delete(state);
  }

  recordSuccess(state: string, connectionId: string, providerId: string): void {
    this.results.set(state, {
      status: 'completed',
      connectionId,
      providerId,
      createdAt: Date.now(),
    });
    this.pruneResults();
  }

  recordFailure(state: string, connectionId: string, providerId: string, message: string): void {
    this.results.set(state, {
      status: 'failed',
      connectionId,
      providerId,
      message,
      createdAt: Date.now(),
    });
    this.pruneResults();
  }

  getResult(state: string): OAuthFlowResult {
    const trimmed = state.trim();
    if (!trimmed) return { status: 'expired', message: 'Missing OAuth state' };

    const stored = this.results.get(trimmed);
    if (stored) {
      if (stored.status === 'completed') {
        return { status: 'completed' };
      }
      return { status: 'failed', message: stored.message ?? 'Google sign-in failed' };
    }

    if (this.peek(trimmed)) {
      if (this.inFlight.has(trimmed)) {
        return { status: 'pending', message: 'Completing sign-in…' };
      }
      return { status: 'pending', message: 'Waiting for browser sign-in…' };
    }

    if (this.inFlight.has(trimmed)) {
      return { status: 'pending', message: 'Completing sign-in…' };
    }

    return { status: 'expired', message: 'Sign-in session expired — click Sign in again.' };
  }

  private prune(): void {
    const now = Date.now();
    for (const [state, entry] of this.pending.entries()) {
      if (now - entry.createdAt > this.ttlMs) this.pending.delete(state);
    }
  }

  private pruneResults(): void {
    const now = Date.now();
    for (const [state, result] of this.results.entries()) {
      if (now - result.createdAt > this.ttlMs) this.results.delete(state);
    }
  }
}

export function buildGoogleOAuthAuthUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes.join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleOAuthCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Token exchange failed (${res.status})`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    getLogger().warn('MCP_STDIO_OAUTH', `Failed to parse token exchange response: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export function writeMcpStdioOAuthCredentials(
  connectionId: string,
  config: IntegrationMcpStdioAuth,
  tokens: Record<string, unknown>,
  baseDir?: string,
): void {
  const paths = getMcpStdioAuthPaths(connectionId, baseDir, config.credentialsFileName);
  mkdirSync(dirname(paths.credentialsPath), { recursive: true });
  writeFileSync(paths.credentialsPath, JSON.stringify(tokens, null, 2), 'utf-8');
}

export interface StartMcpStdioBrowserOAuthInput {
  connectionId: string;
  provider: IntegrationProvider;
  config: IntegrationMcpStdioAuth;
  redirectBaseUrl: string;
  secrets: { env?: Record<string, string> } | null;
  baseDir?: string;
}

export function startMcpStdioBrowserOAuth(
  store: McpStdioOAuthStore,
  input: StartMcpStdioBrowserOAuthInput,
): { authUrl: string; state: string; redirectUri: string } {
  const { connectionId, provider, config, redirectBaseUrl, secrets, baseDir } = input;
  const resolved = resolveMcpStdioAuthCredentials(config, secrets, connectionId, baseDir);
  if (!resolved) {
    throw new Error('OAuth Client ID and Client Secret are required. Re-open the setup wizard and enter both credentials.');
  }

  const redirectUri = getMcpStdioOAuthRedirectUri(redirectBaseUrl, config);
  writeGoogleOAuthKeysFile(
    connectionId,
    resolved.clientId,
    resolved.clientSecret,
    baseDir,
    config,
    redirectUri,
  );

  const pending = store.create({
    connectionId,
    providerId: provider.id,
    redirectUri,
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    config,
  });

  const authUrl = buildGoogleOAuthAuthUrl(
    resolved.clientId,
    redirectUri,
    resolveMcpStdioOAuthScopes(config),
    pending.state,
  );

  return { authUrl, state: pending.state, redirectUri };
}

export async function completeMcpStdioBrowserOAuth(
  store: McpStdioOAuthStore,
  state: string,
  code: string,
  baseDir?: string,
): Promise<{ connectionId: string; providerId: string }> {
  const pending = store.consume(state);
  if (!pending) {
    throw new Error('Sign-in session expired or invalid — click Sign in again.');
  }

  store.markInFlight(state);
  try {
    const tokens = await exchangeGoogleOAuthCode(
      pending.clientId,
      pending.clientSecret,
      pending.redirectUri,
      code,
    );
    writeMcpStdioOAuthCredentials(pending.connectionId, pending.config, tokens, baseDir);
    store.recordSuccess(state, pending.connectionId, pending.providerId);
    return { connectionId: pending.connectionId, providerId: pending.providerId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.recordFailure(state, pending.connectionId, pending.providerId, message);
    throw error;
  } finally {
    store.clearInFlight(state);
  }
}
