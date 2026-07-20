import type { ToolResult } from '@agentx/shared';
import type { ThirdPartyTurnPolicy } from './third-party-access.js';

/** Tools that must not substitute for a missing third-party / MCP integration. */
export const LOCAL_SUBSTITUTE_TOOL_IDS = new Set([
  'shell_exec',
  'bash',
  'python_rpc',
  'script_run',
  'node_rpc',
  'file_find',
  'glob',
  'folder_list',
  'folder_tree',
  'list_dir',
  'search_files',
  'system_env',
  'system_which',
  'system_ports',
  'env_read',
  'memory_fabric_search',
  'code_search',
  'code_grep',
  'grep',
  'ripgrep',
]);

/** Still allowed when local exploration is blocked (public internet + integrations). */
export const ALLOWED_WHEN_LOCAL_BLOCKED = new Set([
  'ask_clarification',
  'web_search',
  'deep_web_search',
  'web_fetch',
  'fetch',
  'fetch_url',
  'http_get',
  'http_request',
]);

/** Shell / script patterns that hunt credentials or other apps' private data — always blocked. */
export const CREDENTIAL_SCAVENGER_PATTERNS: readonly RegExp[] = [
  /application\s+support/i,
  /library\/application\s+support/i,
  /\.config\/gcloud/i,
  /gcloud\s+auth/i,
  /print-access-token/i,
  /claude_desktop_config/i,
  /local-agent-mode-sessions/i,
  /icloudmail/i,
  /mcp-toolkit/i,
  /\/\.lmstudio\/mcp/i,
  /antigravity\/mcp/i,
  /mcp\.json/i,
  /find\s+.*(?:\*mcp\*|\*gmail\*|\*credential\*|\*agent\*)/i,
  /find\s+~\/.*(?:mcp|gmail|credential|oauth)/i,
  /cat\s+.*mcp.*\.json/i,
  /oauth.*(?:token|secret|credential)/i,
  /keychain/i,
  /\/\.aws\/(?:credentials|config)/i,
  /\/\.ssh\//i,
  /googleapiclient/i,
  /server-gmail/i,
];

const CREDENTIAL_ENV_FILTER_RE = /^(?:gmail|mail|oauth|api[_-]?key|secret|token|password|credential)/i;

const SHELL_LIKE_TOOLS = new Set(['shell_exec', 'bash', 'python_rpc', 'script_run', 'node_rpc']);

export function isIntegrationToolId(toolId: string): boolean {
  return toolId.startsWith('integration__');
}

export function isLocalSubstituteTool(toolId: string): boolean {
  return LOCAL_SUBSTITUTE_TOOL_IDS.has(toolId);
}

export function extractShellLikeContent(toolId: string, args: Record<string, unknown>): string {
  if (toolId === 'python_rpc' || toolId === 'script_run' || toolId === 'node_rpc') {
    const script = args['script'] ?? args['code'] ?? args['source'];
    return typeof script === 'string' ? script : '';
  }
  const command = args['command'] ?? args['cmd'];
  return typeof command === 'string' ? command : '';
}

export function isCredentialScavengerAttempt(toolId: string, args: Record<string, unknown>): boolean {
  if (toolId === 'system_env') {
    const filter = args['filter'];
    if (typeof filter === 'string' && CREDENTIAL_ENV_FILTER_RE.test(filter.trim())) {
      return true;
    }
    if (filter === undefined || filter === '' || filter === null) {
      // Dumping full env while hunting secrets
      return false;
    }
  }

  if (!SHELL_LIKE_TOOLS.has(toolId)) return false;

  const content = extractShellLikeContent(toolId, args);
  if (!content.trim()) return false;
  return CREDENTIAL_SCAVENGER_PATTERNS.some((re) => re.test(content));
}

export function blockThirdPartyLocalSubstitute(
  toolId: string,
  policy: ThirdPartyTurnPolicy | null,
): ToolResult | null {
  if (!policy?.blockLocalExploration) return null;
  if (isIntegrationToolId(toolId)) return null;
  if (ALLOWED_WHEN_LOCAL_BLOCKED.has(toolId)) return null;

  if (isLocalSubstituteTool(toolId)) {
    return {
      success: false,
      output: [
        '[Third-party access] Blocked: this request targets an external service or app.',
        policy.reason,
        'Connect the integration in Settings → MCP Store, or use public web tools if no login is required.',
        'Scanning the local filesystem, shell, or environment for credentials or other apps\' configs is not allowed.',
      ].join(' '),
      error: 'THIRD_PARTY_ACCESS_DENIED',
    };
  }

  return null;
}

export function blockCredentialScavenger(
  toolId: string,
  args: Record<string, unknown>,
): ToolResult | null {
  if (!isCredentialScavengerAttempt(toolId, args)) return null;

  return {
    success: false,
    output: [
      '[Security] Blocked: cannot search the local system for other applications\' credentials, tokens, or MCP configs.',
      'Use a connected MCP integration in Settings → MCP Store, or public internet tools when no login is required.',
    ].join(' '),
    error: 'CREDENTIAL_SCAVENGER_BLOCKED',
  };
}
