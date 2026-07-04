import type { IntegrationConnection, IntegrationProvider } from '../../api';

export function isInstalledConnection(connection?: IntegrationConnection): boolean {
  if (!connection) return false;
  return connection.status === 'connected' || connection.status === 'syncing' || connection.status === 'error';
}

export function connectionStatusRank(status: IntegrationConnection['status']): number {
  if (status === 'connected') return 3;
  if (status === 'syncing') return 2;
  if (status === 'error') return 1;
  return 0;
}

export function providerPackageSignIn(provider: IntegrationProvider) {
  return provider.auth.packageSignIn;
}

type HubOAuthProvider = Pick<IntegrationProvider, 'auth' | 'server'>;

export function canUseHubBrowserOAuth(provider: HubOAuthProvider): boolean {
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

export function requiresRemoteUrlForHubOAuth(provider: HubOAuthProvider): boolean {
  if (provider.server.type === 'remote' && provider.server.url) return false;

  const oauth = provider.auth.oauth;
  if (oauth?.discoveryUrl || (oauth?.authorizationUrl && oauth?.tokenUrl)) {
    return false;
  }

  return provider.auth.primary === 'remote_url'
    || (Boolean(oauth) && provider.server.type !== 'remote');
}

export const CATEGORY_LABELS: Record<string, string> = {
  travel: 'Travel',
  productivity: 'Productivity',
  communication: 'Communication',
  finance: 'Finance',
  shopping: 'Shopping',
  smart_home: 'Smart Home',
  dev_ops: 'Dev & Ops',
  custom: 'Custom',
};

export const CATEGORY_ORDER = [
  'productivity',
  'communication',
  'travel',
  'finance',
  'shopping',
  'smart_home',
  'dev_ops',
  'custom',
] as const;

export const TRUST_LABELS: Record<string, string> = {
  official: 'Official',
  verified: 'Verified',
  community: 'Community',
};

export const AUTH_MODE_LABELS: Record<string, string> = {
  oauth: 'OAuth sign-in',
  sign_in_browser: 'Browser sign-in',
  api_key_form: 'API key',
  none: 'No credentials',
  stdio: 'Local stdio',
  env: 'Environment variables',
  remote_url: 'Remote MCP URL',
  import_config: 'Import config',
};

export const CAPABILITY_META = [
  { key: 'search' as const, label: 'Search', description: 'Find and query data across the service' },
  { key: 'read' as const, label: 'Read', description: 'Read files, messages, records, and status' },
  { key: 'write' as const, label: 'Write', description: 'Create and update — requires your approval in chat' },
  { key: 'transact' as const, label: 'Transact', description: 'Payments, bookings, and device control — always confirmed' },
];

export function getProviderPackageLabel(provider: IntegrationProvider): string | undefined {
  if (provider.npmPackage) return provider.npmPackage;
  if (provider.server.package) return provider.server.package;
  if (provider.server.type === 'remote' && provider.server.url) return provider.server.url;
  if (provider.server.args?.length) {
    const pkg = provider.server.args.find((arg) => arg.startsWith('@') || arg.startsWith('mcp-'));
    if (pkg) return pkg;
  }
  return undefined;
}

export function matchesProviderSearch(provider: IntegrationProvider, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    provider.name,
    provider.description,
    provider.id,
    CATEGORY_LABELS[provider.category] ?? provider.category,
    provider.trust,
    provider.evaluationNotes,
    getProviderPackageLabel(provider),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}
