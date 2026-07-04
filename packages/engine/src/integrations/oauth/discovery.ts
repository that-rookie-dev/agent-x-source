import { getLogger } from '@agentx/shared';

export interface OAuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

const metadataCache = new Map<string, { metadata: OAuthServerMetadata; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function normalizeDiscoveryUrl(input: string): string {
  const url = new URL(input);
  if (url.pathname.endsWith('/.well-known/oauth-authorization-server')) return url.toString();
  if (url.pathname.endsWith('/.well-known/openid-configuration')) return url.toString();
  const base = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  return `${base}/.well-known/oauth-authorization-server`;
}

async function fetchWithContext(url: string | URL, init?: RequestInit): Promise<Response> {
  const target = url.toString();
  try {
    return await fetch(target, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    const detail = cause instanceof Error
      ? cause.message
      : error instanceof Error
        ? error.message
        : String(error);
    const host = (() => {
      try { return new URL(target).host; } catch { return target; }
    })();
    if (/ENOTFOUND|getaddrinfo|Could not resolve host/i.test(detail)) {
      throw new Error(`Cannot reach ${host} — the MCP server URL may be wrong or unavailable.`);
    }
    throw new Error(`Network request failed for ${target}: ${detail}`);
  }
}

function parseAuthorizationServer(body: {
  authorization_servers?: string[];
  authorization_server?: string;
}, context: string): string {
  const server = body.authorization_servers?.[0] ?? body.authorization_server;
  if (!server) {
    throw new Error(`No authorization server found for ${context}`);
  }
  return server;
}

async function readProtectedResourceMetadata(response: Response, context: string): Promise<string> {
  if (!response.ok) {
    throw new Error(`MCP resource metadata discovery failed (${response.status}) for ${context}`);
  }
  const body = await response.json() as { authorization_servers?: string[]; authorization_server?: string };
  return parseAuthorizationServer(body, context);
}

async function fetchProtectedResourceMetadata(wellKnownUrl: URL, resourceUrl: string, withResourceQuery: boolean): Promise<string> {
  const url = new URL(wellKnownUrl);
  if (withResourceQuery) {
    url.searchParams.set('resource', resourceUrl);
  }
  const response = await fetchWithContext(url, {
    headers: { Accept: 'application/json' },
  });
  return readProtectedResourceMetadata(response, resourceUrl);
}

async function probeMcpEndpointForMetadata(resourceUrl: string): Promise<string> {
  const response = await fetchWithContext(resourceUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'agent-x', version: '0.8.6' },
      },
    }),
  });

  const wwwAuth = response.headers.get('www-authenticate') ?? response.headers.get('WWW-Authenticate');
  const match = wwwAuth?.match(/resource_metadata="([^"]+)"/i);
  if (match?.[1]) {
    const metadataUrl = match[1].replace(/\\"/g, '"');
    const metadataResponse = await fetchWithContext(metadataUrl, {
      headers: { Accept: 'application/json' },
    });
    return readProtectedResourceMetadata(metadataResponse, resourceUrl);
  }

  throw new Error(`MCP server at ${resourceUrl} did not advertise OAuth metadata in WWW-Authenticate`);
}

/** MCP resource metadata (RFC 9728) — locates the authorization server for a remote MCP resource. */
export async function discoverMcpResourceAuthorizationServer(resourceUrl: string): Promise<string> {
  const resource = new URL(resourceUrl);
  const pathSegment = resource.pathname.replace(/^\//, '').replace(/\/$/, '');

  const attempts: Array<() => Promise<string>> = [
    () => probeMcpEndpointForMetadata(resourceUrl),
    () => fetchProtectedResourceMetadata(new URL('/.well-known/oauth-protected-resource', resource.origin), resourceUrl, true),
  ];

  if (pathSegment) {
    attempts.push(
      () => fetchProtectedResourceMetadata(
        new URL(`/.well-known/oauth-protected-resource/${pathSegment}`, resource.origin),
        resourceUrl,
        false,
      ),
      () => fetchProtectedResourceMetadata(
        new URL(`/.well-known/oauth-protected-resource/${pathSegment}`, resource.origin),
        resourceUrl,
        true,
      ),
    );
  }

  let lastError: Error | undefined;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(`Could not discover authorization server for MCP resource ${resourceUrl}`);
}

export async function discoverAuthorizationServerMetadata(discoveryUrl: string): Promise<OAuthServerMetadata> {
  const normalized = normalizeDiscoveryUrl(discoveryUrl);
  const cached = metadataCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.metadata;

  let response = await fetchWithContext(normalized, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok && normalized.endsWith('/.well-known/oauth-authorization-server')) {
    const openIdUrl = normalized.replace('/.well-known/oauth-authorization-server', '/.well-known/openid-configuration');
    response = await fetchWithContext(openIdUrl, {
      headers: { Accept: 'application/json' },
    });
  }

  if (!response.ok) {
    throw new Error(`OAuth discovery failed (${response.status}) for ${normalized}`);
  }
  const metadata = await response.json() as OAuthServerMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(`OAuth discovery response missing authorization or token endpoint (${normalized})`);
  }
  metadataCache.set(normalized, { metadata, expiresAt: Date.now() + CACHE_TTL_MS });
  return metadata;
}

export async function resolveOAuthMetadata(options: {
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  remoteResourceUrl?: string;
}): Promise<OAuthServerMetadata> {
  if (options.authorizationUrl && options.tokenUrl) {
    return {
      authorization_endpoint: options.authorizationUrl,
      token_endpoint: options.tokenUrl,
    };
  }
  if (options.discoveryUrl) {
    return discoverAuthorizationServerMetadata(options.discoveryUrl);
  }
  if (options.remoteResourceUrl) {
    const authServer = await discoverMcpResourceAuthorizationServer(options.remoteResourceUrl);
    return discoverAuthorizationServerMetadata(authServer);
  }
  throw new Error('OAuth configuration requires discoveryUrl, explicit endpoints, or a remote MCP resource URL.');
}

export function supportsPkce(metadata: OAuthServerMetadata): boolean {
  const methods = metadata.code_challenge_methods_supported ?? ['S256'];
  return methods.includes('S256');
}

export function clearOAuthDiscoveryCache(): void {
  metadataCache.clear();
  getLogger().debug('OAUTH_DISCOVERY_CACHE_CLEARED', 'cache cleared');
}
