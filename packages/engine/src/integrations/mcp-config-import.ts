import type { ConnectIntegrationRequest, IntegrationConnection, McpImportConfig } from '@agentx/shared';
import type { IntegrationHub } from './integration-hub.js';
import { createCustomProvider } from './integration-hub.js';

export interface McpImportResult {
  imported: IntegrationConnection[];
  errors: Array<{ name: string; error: string }>;
}

export async function importMcpConfig(hub: IntegrationHub, config: McpImportConfig): Promise<McpImportResult> {
  const imported: IntegrationConnection[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    try {
      const provider = createCustomProvider(name);
      const request: ConnectIntegrationRequest = {
        displayName: name,
        authMode: entry.url ? 'remote_url' : 'stdio',
      };
      if (entry.url) {
        request.remote = { url: entry.url };
      } else {
        if (!entry.command) throw new Error('stdio server requires command');
        request.stdio = {
          command: entry.command,
          args: entry.args ?? [],
        };
      }
      if (entry.env && Object.keys(entry.env).length > 0) {
        request.env = entry.env;
      }
      const connection = await hub.connectCustom(provider, request);
      imported.push(connection);
    } catch (error) {
      errors.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { imported, errors };
}

export function parseMcpImportConfig(raw: unknown): McpImportConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid MCP import config: expected JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const servers = obj.mcpServers;
  if (!servers || typeof servers !== 'object') {
    throw new Error('Invalid MCP import config: missing mcpServers object');
  }
  return { mcpServers: servers as McpImportConfig['mcpServers'] };
}
