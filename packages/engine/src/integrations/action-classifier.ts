import type { IntegrationProvider } from '@agentx/shared';

const READ_PREFIXES = [
  'get', 'list', 'search', 'read', 'fetch', 'find', 'query', 'describe', 'lookup', 'show', 'view',
  'status', 'check', 'health', 'ping', 'info', 'validate', 'whoami', 'browse', 'explore', 'analyze', 'analyse',
];
const READ_INFIXES = ['_status', '_info', '_health', '_check', '_search', '_read', '_fetch', '_query', '_lookup'];
const WRITE_PREFIXES = ['create', 'update', 'delete', 'remove', 'send', 'post', 'book', 'pay', 'cancel', 'write', 'set', 'add', 'put', 'patch', 'insert', 'publish', 'deploy', 'run', 'execute', 'commit', 'merge'];

const EDIT_DELETE_TOKENS = [
  'update', 'delete', 'remove', 'patch', 'edit', 'cancel', 'destroy', 'revoke', 'overwrite', 'replace',
];

export function isIntegrationEditOrDeleteTool(
  toolName: string,
  _provider?: IntegrationProvider,
): boolean {
  const normalized = toolName.toLowerCase();

  return EDIT_DELETE_TOKENS.some((token) =>
    normalized === token
    || normalized.startsWith(`${token}_`)
    || normalized.endsWith(`_${token}`)
    || normalized.includes(`_${token}_`),
  );
}

export function isReadOnlyIntegrationTool(
  toolName: string,
  provider?: IntegrationProvider,
): boolean {
  const normalized = toolName.toLowerCase();

  if (provider?.tools?.alwaysConfirm?.some((name) => normalized.includes(name.toLowerCase()))) {
    return false;
  }
  if (provider?.tools?.autoExecute?.some((name) => normalized.includes(name.toLowerCase()))) {
    return true;
  }

  if (provider?.auth.packageSignIn) {
    const signIn = provider.auth.packageSignIn;
    if (signIn.statusTool && normalized === signIn.statusTool.toLowerCase()) return true;
    if (signIn.progressTool && normalized === signIn.progressTool.toLowerCase()) return true;
  }

  if (READ_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`_${prefix}`))) {
    return true;
  }
  if (READ_INFIXES.some((token) => normalized.includes(token))) {
    return true;
  }
  if (WRITE_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`_${prefix}`))) {
    return false;
  }

  // Unknown tools default to confirm-first (not read-only).
  return false;
}

export function integrationToolRiskLevel(
  toolName: string,
  provider?: IntegrationProvider,
): 'low' | 'medium' | 'high' | 'critical' {
  const normalized = toolName.toLowerCase();
  if (provider?.tools?.alwaysConfirm?.some((name) => normalized.includes(name.toLowerCase()))) {
    return 'high';
  }
  if (['pay', 'book', 'purchase', 'charge', 'transfer', 'delete', 'remove', 'cancel'].some((w) => normalized.includes(w))) {
    return 'critical';
  }
  if (isReadOnlyIntegrationTool(toolName, provider)) {
    return 'low';
  }
  if (['create', 'update', 'write', 'set', 'add', 'put', 'patch'].some((w) => normalized.includes(w))) {
    return 'medium';
  }
  return 'high';
}

/** Prefix for provider-safe tool IDs (Anthropic/OpenAI: ^[a-zA-Z0-9_-]{1,128}$). */
export const INTEGRATION_TOOL_PREFIX = 'integration__';
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function sanitizeIntegrationSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

export function isIntegrationToolId(toolId: string): boolean {
  return toolId.startsWith(INTEGRATION_TOOL_PREFIX);
}

export function integrationToolId(providerId: string, toolName: string): string {
  const safeProvider = sanitizeIntegrationSegment(providerId);
  const safeName = sanitizeIntegrationSegment(toolName);
  const prefix = `${INTEGRATION_TOOL_PREFIX}${safeProvider}__`;
  const maxNameLen = Math.max(1, 128 - prefix.length);
  const trimmedName = safeName.length > maxNameLen ? safeName.slice(0, maxNameLen) : safeName;
  const id = `${prefix}${trimmedName}`;
  if (!PROVIDER_TOOL_NAME_PATTERN.test(id)) {
    throw new Error(`Invalid integration tool id: ${id}`);
  }
  return id;
}

export function parseIntegrationToolId(toolId: string): { providerId: string; toolName: string } | null {
  if (toolId.startsWith(INTEGRATION_TOOL_PREFIX)) {
    const rest = toolId.slice(INTEGRATION_TOOL_PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep <= 0) return null;
    return {
      providerId: rest.slice(0, sep),
      toolName: rest.slice(sep + 2),
    };
  }

  return null;
}

/** Prefixes for unregistering integration tools from the registry. */
export function integrationToolUnregisterPrefixes(providerId?: string): string[] {
  if (providerId) {
    const safeProvider = sanitizeIntegrationSegment(providerId);
    return [`${INTEGRATION_TOOL_PREFIX}${safeProvider}__`];
  }
  return [INTEGRATION_TOOL_PREFIX];
}
