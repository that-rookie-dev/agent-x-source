import type { IntegrationOAuthConfig } from '@agentx/shared';
import { resolveOAuthMetadata, type OAuthServerMetadata } from './discovery.js';
import type { PkceChallenge } from './pkce-flow.js';

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface BuildAuthUrlOptions {
  oauth: IntegrationOAuthConfig;
  challenge: PkceChallenge;
  redirectUri: string;
  remoteResourceUrl?: string;
}

export async function buildAuthorizationUrl(options: BuildAuthUrlOptions): Promise<string> {
  const metadata = await resolveOAuthMetadata({
    discoveryUrl: options.oauth.discoveryUrl,
    authorizationUrl: options.oauth.authorizationUrl,
    tokenUrl: options.oauth.tokenUrl,
    remoteResourceUrl: options.remoteResourceUrl,
  });
  const clientId = resolveClientId(options.oauth);
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('state', options.challenge.state);
  url.searchParams.set('code_challenge', options.challenge.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (options.oauth.scopes?.length) {
    url.searchParams.set('scope', options.oauth.scopes.join(' '));
  }
  const resource = options.oauth.resource ?? options.remoteResourceUrl;
  if (resource) {
    url.searchParams.set('resource', resource);
  }
  return url.toString();
}

export async function exchangeAuthorizationCode(options: {
  oauth: IntegrationOAuthConfig;
  challenge: PkceChallenge;
  code: string;
  redirectUri: string;
  remoteResourceUrl?: string;
}): Promise<OAuthTokenResponse> {
  const metadata = await resolveOAuthMetadata({
    discoveryUrl: options.oauth.discoveryUrl,
    authorizationUrl: options.oauth.authorizationUrl,
    tokenUrl: options.oauth.tokenUrl,
    remoteResourceUrl: options.remoteResourceUrl,
  });
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', options.code);
  body.set('redirect_uri', options.redirectUri);
  body.set('client_id', resolveClientId(options.oauth));
  body.set('code_verifier', options.challenge.codeVerifier);
  const resource = options.oauth.resource ?? options.remoteResourceUrl;
  if (resource) body.set('resource', resource);

  return postTokenRequest(metadata, body);
}

export async function refreshAccessToken(options: {
  oauth: IntegrationOAuthConfig;
  refreshToken: string;
  remoteResourceUrl?: string;
}): Promise<OAuthTokenResponse> {
  const metadata = await resolveOAuthMetadata({
    discoveryUrl: options.oauth.discoveryUrl,
    authorizationUrl: options.oauth.authorizationUrl,
    tokenUrl: options.oauth.tokenUrl,
    remoteResourceUrl: options.remoteResourceUrl,
  });
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', options.refreshToken);
  body.set('client_id', resolveClientId(options.oauth));
  const resource = options.oauth.resource ?? options.remoteResourceUrl;
  if (resource) body.set('resource', resource);
  return postTokenRequest(metadata, body);
}

async function postTokenRequest(metadata: OAuthServerMetadata, body: URLSearchParams): Promise<OAuthTokenResponse> {
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as OAuthTokenResponse & { error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description ?? payload.error ?? response.statusText;
    throw new Error(`OAuth token request failed: ${detail}`);
  }
  return payload;
}

export function tryResolveClientId(oauth: IntegrationOAuthConfig): string | undefined {
  try {
    return resolveClientId(oauth);
  } catch {
    return undefined;
  }
}

export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName = 'Agent-X',
): Promise<string> {
  const response = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as { client_id?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.client_id) {
    const detail = payload.error_description ?? payload.error ?? response.statusText;
    throw new Error(`OAuth dynamic client registration failed: ${detail}`);
  }
  return payload.client_id;
}

function resolveClientId(oauth: IntegrationOAuthConfig): string {
  if (oauth.clientId?.trim()) return oauth.clientId.trim();
  if (oauth.clientIdEnv) {
    const value = process.env[oauth.clientIdEnv]?.trim();
    if (value) return value;
    throw new Error(`OAuth client id env var ${oauth.clientIdEnv} is not set.`);
  }
  throw new Error('OAuth client id is not configured for this provider.');
}

export function tokenExpiresAt(expiresIn?: number): string | undefined {
  if (!expiresIn || expiresIn <= 0) return undefined;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}
