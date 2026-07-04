import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getLogger } from '@agentx/shared';
import { buildStdioEnv } from '@agentx/shared';

export interface McpConnectStdioOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpConnectRemoteOptions {
  url: string;
  headers?: Record<string, string>;
  transport?: 'streamable-http' | 'sse';
}

export class McpSession {
  private client: Client;
  readonly label: string;

  private constructor(
    client: Client,
    _transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport,
    label: string,
  ) {
    this.client = client;
    this.label = label;
    void _transport;
  }

  static async connectStdio(options: McpConnectStdioOptions): Promise<McpSession> {
    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args ?? [],
      env: buildStdioEnv(options.env),
      cwd: options.cwd,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'agent-x', version: '0.8.6' });
    await client.connect(transport);
    return new McpSession(client, transport, `${options.command} ${(options.args ?? []).join(' ')}`.trim());
  }

  static async connectRemote(options: McpConnectRemoteOptions): Promise<McpSession> {
    const url = new URL(options.url);
    const requestInit = options.headers ? { headers: options.headers } : undefined;
    const transport = options.transport === 'sse'
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });
    const client = new Client({ name: 'agent-x', version: '0.8.6' });
    await client.connect(transport);
    return new McpSession(client, transport, options.url);
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  async listResources(cursor?: string): Promise<{
    resources: Array<{ uri: string; name?: string; mimeType?: string }>;
    nextCursor?: string;
  }> {
    const result = await this.client.listResources(cursor ? { cursor } : undefined);
    return {
      resources: result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        mimeType: resource.mimeType,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async readResource(uri: string): Promise<unknown> {
    return this.client.readResource({ uri });
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch (error) {
      getLogger().warn('MCP_SESSION_CLOSE', error instanceof Error ? error.message : String(error));
    }
  }
}
