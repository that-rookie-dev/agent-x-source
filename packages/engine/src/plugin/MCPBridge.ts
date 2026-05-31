import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  MCPBridgeConfig,
  MCPTransport,
  PluginManifest,
  PluginInstance,
  ToolDefinition,
  ToolParameter,
  ToolRiskLevel,
} from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getConfigDir } from '../config/paths.js';

const logger = getLogger();

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpConnection {
  id: number;
  proc?: ChildProcess;
  url?: string;
  controller?: AbortController;
  requestId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; stream?: (chunk: unknown) => void }>;
  buffer: string;
}

interface McpServerPool {
  config: MCPBridgeConfig;
  name: string;
  tools: ToolDefinition[];
  connections: McpConnection[];
  nextConn: number;
}

const MCP_CONFIG_PATH = join(getConfigDir(), 'mcp.json');

export class MCPBridge {
  private servers: Map<string, McpServerPool> = new Map();
  private allowlist: Set<string> = new Set();
  private blocklist: Set<string> = new Set();

  setAllowlist(names: string[]): void {
    this.allowlist = new Set(names);
  }

  setBlocklist(names: string[]): void {
    this.blocklist = new Set(names);
  }

  getAllowlist(): string[] {
    return [...this.allowlist];
  }

  getBlocklist(): string[] {
    return [...this.blocklist];
  }

  private isAllowed(name: string): boolean {
    if (this.blocklist.has(name)) return false;
    if (this.allowlist.size > 0 && !this.allowlist.has(name)) return false;
    return true;
  }

  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];
    const configs = this.loadConfig();
    for (const [name, cfg] of Object.entries(configs)) {
      if (cfg.enabled === false) continue;
      if (!this.isAllowed(name)) continue;
      manifests.push({
        id: `mcp:${name}`,
        name: `MCP:${name}`,
        version: '0.1.0',
        description: `MCP server "${name}"`,
        source: 'mcp',
        tools: [],
      });
    }
    return manifests;
  }

  /**
   * Start an MCP server from its manifest (used by App.tsx auto-start).
   */
  async start(manifest: PluginManifest): Promise<void> {
    await this.load(manifest);
  }

  async load(manifest: PluginManifest): Promise<PluginInstance> {
    const name = manifest.id.replace(/^mcp:/, '');
    if (!this.isAllowed(name)) {
      throw new Error(`MCP server "${name}" is not allowed (blocked or not in allowlist)`);
    }
    const configs = this.loadConfig();
    const cfg = configs[name];
    if (!cfg) {
      throw new Error(`MCP server "${name}" not found in config`);
    }

    await this.startServer(name, cfg);
    const pool = this.servers.get(name);
    const tools = pool?.tools ?? [];

    const instance: PluginInstance = {
      manifest,
      enabled: true,
      config: {},
      tools,
      start: async () => { /* Already started */ },
      stop: async () => {
        await this.stopServer(name);
      },
      execute: async (toolId: string, args: Record<string, unknown>) => {
        try {
          const result = await this.callTool(name, toolId, args);
          const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          return { success: true, output };
        } catch (error) {
          return { success: false, output: `MCP tool call failed: ${(error as Error).message}`, error: 'MCP_ERROR' };
        }
      },
    };

    return instance;
  }

  async unload(name: string): Promise<void> {
    await this.stopServer(name.replace(/^mcp:/, ''));
  }

  updateServerConfig(name: string, config: Partial<MCPBridgeConfig>): void {
    const configs = this.loadConfig();
    if (!configs[name]) throw new Error(`MCP server "${name}" not found in config`);
    configs[name] = { ...configs[name], ...config };
    this.saveConfig(configs);
  }

  getServerConfig(name: string): MCPBridgeConfig | undefined {
    const configs = this.loadConfig();
    return configs[name];
  }

  getLoaded(): PluginInstance[] {
    return [];
  }

  getServerNames(): string[] {
    return [...this.servers.keys()];
  }

  getServerStatus(): Array<{ name: string; running: boolean; toolCount: number; error?: string }> {
    return [...this.servers.entries()].map(([name, pool]) => ({
      name,
      running: pool.connections.some((c) => c.proc ? !c.proc.killed : true),
      toolCount: pool.tools.length,
    }));
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>, onStream?: (chunk: unknown) => void): Promise<unknown> {
    const pool = this.servers.get(serverName);
    if (!pool || pool.connections.length === 0) {
      throw new Error(`MCP server "${serverName}" is not running`);
    }
    const conn = pool.connections[pool.nextConn % pool.connections.length]!;
    pool.nextConn++;
    return this.sendRequest(conn, 'tools/call', { name: toolName, arguments: args }, onStream);
  }

  async listTools(serverName: string): Promise<McpToolDefinition[]> {
    const pool = this.servers.get(serverName);
    if (!pool || pool.connections.length === 0) throw new Error(`MCP server "${serverName}" is not running`);
    const result = await this.sendRequest(pool.connections[0]!, 'tools/list', {});
    const tools = result as { tools?: McpToolDefinition[] };
    return tools?.tools ?? [];
  }

  async dispose(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.stopServer(name);
    }
  }

  private loadConfig(): Record<string, MCPBridgeConfig> {
    if (!existsSync(MCP_CONFIG_PATH)) {
      this.seedDefaultServers();
    }
    try {
      const raw = readFileSync(MCP_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const configs: Record<string, MCPBridgeConfig> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (key.startsWith('_')) {
          if (key === '_allowlist') this.allowlist = new Set(val as string[]);
          if (key === '_blocklist') this.blocklist = new Set(val as string[]);
          continue;
        }
        configs[key] = val as MCPBridgeConfig;
      }
      return configs;
    } catch {
      logger.error('MCP_CONFIG_PARSE_ERROR', { path: MCP_CONFIG_PATH });
      return {};
    }
  }

  protected saveConfig(configs: Record<string, MCPBridgeConfig>): void {
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(configs, null, 2));
  }

  /**
   * Seed default MCP servers on first run.
   * User only needs to configure the command/args/env — everything else is ready.
   */
  private seedDefaultServers(): void {
    const defaults: Record<string, MCPBridgeConfig> = {
      'filesystem': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/'], transport: 'stdio', env: {}, enabled: false },
      'github': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], transport: 'stdio', env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }, enabled: false },
      'postgres': { command: 'npx', args: ['-y', '@anthropic/mcp-server-postgres'], transport: 'stdio', env: { DATABASE_URL: '' }, enabled: false },
      'sqlite': { command: 'npx', args: ['-y', '@anthropic/mcp-server-sqlite'], transport: 'stdio', env: { SQLITE_PATH: '' }, enabled: false },
      'brave-search': { command: 'npx', args: ['-y', '@anthropic/mcp-server-brave-search'], transport: 'stdio', env: { BRAVE_API_KEY: '' }, enabled: false },
      'puppeteer': { command: 'npx', args: ['-y', '@anthropic/mcp-server-puppeteer'], transport: 'stdio', env: {}, enabled: false },
      'memory': { command: 'npx', args: ['-y', '@anthropic/mcp-server-memory'], transport: 'stdio', env: {}, enabled: false },
      'git': { command: 'npx', args: ['-y', '@anthropic/mcp-server-git'], transport: 'stdio', env: { GIT_ROOT: '.' }, enabled: false },
      'google-maps': { command: 'npx', args: ['-y', '@anthropic/mcp-server-google-maps'], transport: 'stdio', env: { GOOGLE_MAPS_API_KEY: '' }, enabled: false },
      'slack': { command: 'npx', args: ['-y', '@anthropic/mcp-server-slack'], transport: 'stdio', env: { SLACK_BOT_TOKEN: '' }, enabled: false },
      'everart': { command: 'npx', args: ['-y', '@anthropic/mcp-server-everart'], transport: 'stdio', env: { EVERART_API_KEY: '' }, enabled: false },
      'sequential-thinking': { command: 'npx', args: ['-y', '@anthropic/mcp-server-sequential-thinking'], transport: 'stdio', env: {}, enabled: false },
      'exa-search': { command: 'npx', args: ['-y', '@anthropic/mcp-server-exa-search'], transport: 'stdio', env: { EXA_API_KEY: '' }, enabled: false },
      'notion': { command: 'npx', args: ['-y', '@anthropic/mcp-server-notion'], transport: 'stdio', env: { NOTION_API_TOKEN: '' }, enabled: false },
      'airtable': { command: 'npx', args: ['-y', '@anthropic/mcp-server-airtable'], transport: 'stdio', env: { AIRTABLE_API_KEY: '', AIRTABLE_BASE_ID: '', AIRTABLE_TABLE_ID: '' }, enabled: false },
      'docker': { command: 'docker', args: ['run', '-i', '--rm', 'mcp/docker'], transport: 'stdio', env: {}, enabled: false },
      'playwright': { command: 'npx', args: ['-y', '@anthropic/mcp-server-playwright'], transport: 'stdio', env: {}, enabled: false },
      'fetch': { command: 'npx', args: ['-y', '@anthropic/mcp-server-fetch'], transport: 'stdio', env: {}, enabled: false },
      'mysql': { command: 'npx', args: ['-y', '@anthropic/mcp-server-mysql'], transport: 'stdio', env: { MYSQL_URL: '' }, enabled: false },
      'redis': { command: 'npx', args: ['-y', '@anthropic/mcp-server-redis'], transport: 'stdio', env: { REDIS_URL: '' }, enabled: false },
      'elasticsearch': { command: 'npx', args: ['-y', '@anthropic/mcp-server-elasticsearch'], transport: 'stdio', env: { ELASTICSEARCH_URL: '' }, enabled: false },
      'rag': { command: 'npx', args: ['-y', '@anthropic/mcp-server-rag'], transport: 'stdio', env: { OPENAI_API_KEY: '', CHROMA_URL: '' }, enabled: false },
    };
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(defaults, null, 2));
    logger.info('MCP', `Seeded ${Object.keys(defaults).length} default servers`);
  }

  private async startServer(name: string, config: MCPBridgeConfig): Promise<void> {
    if (this.servers.has(name)) return;

    const transport: MCPTransport = config.transport ?? 'stdio';
    const poolSize = config.poolSize ?? 1;
    const pool: McpServerPool = {
      config,
      name,
      tools: [],
      connections: [],
      nextConn: 0,
    };

    for (let i = 0; i < poolSize; i++) {
      try {
        let conn: McpConnection;
        if (transport === 'sse' || transport === 'http') {
          conn = await this.connectHttp(name, config, transport);
        } else {
          conn = await this.connectStdio(name, config);
        }
        pool.connections.push(conn);
      } catch (e) {
        logger.error('MCP_CONNECT_FAILED', `Failed to connect MCP "${name}" (conn ${i}): ${(e as Error).message}`);
      }
    }

    if (pool.connections.length === 0) {
      throw new Error(`Failed to establish any connection for MCP server "${name}"`);
    }

    this.servers.set(name, pool);

    // Discover tools from first connection
    try {
      const result = await this.sendRequest(pool.connections[0]!, 'tools/list', {});
      const tools = (result as { tools?: McpToolDefinition[] })?.tools ?? [];
      pool.tools = tools.map((t) => this.mcpToolToDefinition(t, name));
    } catch (e) {
      logger.error('MCP_TOOLS_LIST_FAILED', { server: name, error: (e as Error).message });
    }
  }

  private async connectStdio(name: string, config: MCPBridgeConfig): Promise<McpConnection> {
    return new Promise((resolve, reject) => {
      const proc = spawn(config.command, config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...config.env },
      });

      const conn: McpConnection = {
        id: Date.now(),
        proc,
        requestId: 0,
        pending: new Map(),
        buffer: '',
      };

      proc.stdout!.on('data', (data: Buffer) => {
        conn.buffer += data.toString();
        this.processBuffer(conn, config);
      });

      proc.stderr.on('data', (data: Buffer) => {
        logger.info('MCP_STDERR', `[${name}] ${data.toString()}`);
      });

      proc.on('close', (code) => {
        logger.info('MCP_SERVER_CLOSED', `Server ${name} exited with code ${code}`);
        for (const [, pending] of conn.pending) {
          pending.reject(new Error(`MCP server "${name}" exited with code ${code}`));
        }
        conn.pending.clear();
        this.removeConnection(name, conn.id);
      });

      proc.on('error', (err) => {
        logger.error('MCP_SERVER_ERROR', { server: name, error: err.message });
        this.removeConnection(name, conn.id);
        reject(err);
      });

      resolve(conn);
    });
  }

  private async connectHttp(name: string, config: MCPBridgeConfig, transport: MCPTransport): Promise<McpConnection> {
    const url = config.url ?? `http://localhost/${name}`;
    const conn: McpConnection = {
      id: Date.now(),
      url,
      requestId: 0,
      pending: new Map(),
      buffer: '',
    };

    if (transport === 'sse') {
      const controller = new AbortController();
      conn.controller = controller;
      void this.listenSSE(url, conn, config);
    }

    return conn;
  }

  private async listenSSE(url: string, conn: McpConnection, _config: MCPBridgeConfig): Promise<void> {
    try {
      const res = await fetch(url, { signal: conn.controller?.signal });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            try {
              const response: JsonRpcResponse = JSON.parse(data);
              const pending = conn.pending.get(response.id);
              if (pending) {
                conn.pending.delete(response.id);
                if (response.error) {
                  pending.reject(new Error(`MCP error: ${response.error.message}`));
                } else {
                  pending.resolve(response.result);
                }
              }
            } catch {
              logger.info('MCP_SSE_PARSE_FAILED', `Failed to parse SSE data: ${data}`);
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        logger.error('MCP_SSE_ERROR', `SSE connection error: ${(e as Error).message}`);
      }
    }
  }

  private async stopServer(name: string): Promise<void> {
    const pool = this.servers.get(name);
    if (!pool) return;

    for (const conn of pool.connections) {
      if (conn.proc) {
        try {
          conn.proc.kill('SIGTERM');
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              conn.proc!.kill('SIGKILL');
              resolve();
            }, 3000);
            conn.proc!.on('close', () => { clearTimeout(timer); resolve(); });
          });
        } catch {
          conn.proc?.kill('SIGKILL');
        }
      }
      conn.controller?.abort();
    }

    this.servers.delete(name);
  }

  private removeConnection(name: string, connId: number): void {
    const pool = this.servers.get(name);
    if (!pool) return;
    pool.connections = pool.connections.filter((c) => c.id !== connId);
    if (pool.connections.length === 0) {
      this.servers.delete(name);
    }
  }

  private async sendRequest(conn: McpConnection, method: string, params: Record<string, unknown>, onStream?: (chunk: unknown) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++conn.requestId;
      conn.pending.set(id, { resolve, reject, stream: onStream });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      if (conn.url && method === 'tools/call') {
        // HTTP transport: POST to URL
        void this.httpPost(conn, request, id);
      } else if (conn.proc) {
        // stdio transport: write to stdin
        conn.proc.stdin!.write(JSON.stringify(request) + '\n');
      } else {
        conn.pending.delete(id);
        reject(new Error('No transport available for MCP connection'));
      }
    });
  }

  private async httpPost(conn: McpConnection, request: JsonRpcRequest, id: number): Promise<void> {
    const pending = conn.pending.get(id);
    if (!pending) return;

    try {
      const res = await fetch(conn.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!res.body) {
        const data = await res.json() as JsonRpcResponse;
        if (data.error) pending.reject(new Error(`MCP error: ${data.error.message}`));
        else pending.resolve(data.result);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const response: JsonRpcResponse = JSON.parse(trimmed);
            if (pending.stream && response.result) {
              pending.stream(response.result);
            }
            if (response.id === id) {
              conn.pending.delete(id);
              if (response.error) pending.reject(new Error(`MCP error: ${response.error.message}`));
              else pending.resolve(response.result);
              return;
            }
          } catch {
            // Partial/streaming data
            if (pending.stream && trimmed) {
              pending.stream(trimmed);
            }
          }
        }
      }
    } catch (e) {
      conn.pending.delete(id);
      pending.reject(new Error(`MCP HTTP request failed: ${(e as Error).message}`));
    }
  }

  private processBuffer(conn: McpConnection, config: MCPBridgeConfig): void {
    const maxOutput = config.maxOutputSize ?? 100_000;
    if (conn.buffer.length > maxOutput * 2) {
      conn.buffer = conn.buffer.slice(-maxOutput);
    }
    const lines = conn.buffer.split('\n');
    conn.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response: JsonRpcResponse = JSON.parse(trimmed);
        const pending = conn.pending.get(response.id);
        if (pending) {
          conn.pending.delete(response.id);
          if (response.error) {
            pending.reject(new Error(`MCP error: ${response.error.message}`));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        logger.info('MCP_PARSE_FAILED', `Failed to parse MCP response: ${trimmed}`);
      }
    }
  }

  private mcpToolToDefinition(tool: McpToolDefinition, serverName: string): ToolDefinition {
    const props: Record<string, ToolParameter> = {};
    const required: string[] = [];

    if (tool.inputSchema?.properties) {
      const schema = tool.inputSchema as { properties: Record<string, Record<string, unknown>> };
      for (const [key, val] of Object.entries(schema.properties)) {
        props[key] = {
          type: String(val['type'] ?? 'string'),
          description: String(val['description'] ?? ''),
        };
      }
    }
    if (tool.inputSchema?.required) {
      const req = tool.inputSchema as { required?: string[] };
      if (Array.isArray(req.required)) required.push(...req.required);
    }

    const pool = [...this.servers.values()].find((p) => p.name === serverName);
    const riskLevel: ToolRiskLevel = pool?.config.permissionLevel ?? 'medium';

    return {
      id: `mcp:${serverName}:${tool.name}`,
      name: tool.name,
      description: tool.description ?? '',
      modelDescription: `[MCP ${serverName}] ${tool.description ?? tool.name}`,
      category: 'mcp_integration',
      riskLevel,
      schema: { type: 'object', properties: props, required },
      composable: true,
      source: 'mcp',
    };
  }
}
