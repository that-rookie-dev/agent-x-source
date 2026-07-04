import type { IntegrationOAuthConfig, IntegrationProvider } from '../types/integrations.js';

/** Whether this provider can sign in through Agent-X's browser OAuth callback. */
export function canUseHubBrowserOAuth(provider: IntegrationProvider): boolean {
  const oauth = provider.auth.oauth;
  const remoteUrl = provider.server.type === 'remote' ? provider.server.url : undefined;

  if (oauth?.discoveryUrl || (oauth?.authorizationUrl && oauth?.tokenUrl)) {
    return true;
  }

  if (remoteUrl || oauth?.resource) {
    return true;
  }

  if (
    (provider.auth.primary === 'oauth' || provider.auth.primary === 'sign_in_browser')
    && provider.server.type === 'remote'
    && Boolean(remoteUrl)
  ) {
    return true;
  }

  if (provider.auth.primary === 'remote_url' && oauth) {
    return true;
  }

  return false;
}

export function requiresRemoteUrlForHubOAuth(provider: IntegrationProvider): boolean {
  if (provider.server.type === 'remote' && provider.server.url) return false;

  const oauth = provider.auth.oauth;
  if (oauth?.discoveryUrl || (oauth?.authorizationUrl && oauth?.tokenUrl)) {
    return false;
  }

  return provider.auth.primary === 'remote_url'
    || (Boolean(oauth) && provider.server.type !== 'remote');
}

export function resolveProviderOAuthConfig(
  provider: IntegrationProvider,
  remoteResourceUrl?: string,
): IntegrationOAuthConfig {
  const remoteUrl = remoteResourceUrl ?? provider.server.url;
  const oauth = provider.auth.oauth ?? { resource: remoteUrl, scopes: ['mcp'] };

  if (!oauth.resource && remoteUrl) {
    return { ...oauth, resource: remoteUrl };
  }

  return oauth;
}

export function assertHubOAuthReady(provider: IntegrationProvider, remoteResourceUrl?: string): string {
  const remoteUrl = (remoteResourceUrl ?? provider.server.url)?.trim() || undefined;

  if (!canUseHubBrowserOAuth(provider)) {
    throw new Error(
      `${provider.name} authenticates inside its local MCP package. Use the Developer tab or the package auth command.`,
    );
  }

  if (requiresRemoteUrlForHubOAuth(provider) && !remoteUrl) {
    throw new Error(`Enter your ${provider.name} MCP server URL before signing in.`);
  }

  const oauth = provider.auth.oauth;
  if (!remoteUrl && !oauth?.discoveryUrl && !(oauth?.authorizationUrl && oauth?.tokenUrl)) {
    throw new Error(`Provider "${provider.id}" is missing a remote MCP endpoint for OAuth discovery.`);
  }

  return remoteUrl ?? '';
}
