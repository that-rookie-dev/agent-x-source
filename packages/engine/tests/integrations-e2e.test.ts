import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationHub, createCustomProvider } from '../src/integrations/integration-hub.js';
import { expandStdioArgs } from '../src/integrations/stdio-args.js';
import { parseIntegrationStructuredResult } from '../src/integrations/integration-result.js';

const e2eEnabled = process.env.INTEGRATION_E2E === '1' || process.env.CI === 'true';

describe.skipIf(!e2eEnabled)('integrations MCP E2E', () => {
  it('connects to the fetch MCP server via stdio', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agentx-int-e2e-'));
    const hub = new IntegrationHub({ baseDir, redirectBaseUrl: 'http://127.0.0.1:3333' });
    try {
      const connection = await hub.connect('fetch', { authMode: 'none' });
      expect(connection.status, connection.error ?? 'no error detail').toBe('connected');
      expect(connection.toolCount).toBeGreaterThan(0);

      const health = hub.getHealth(connection.id);
      expect(health?.status).toBe('connected');
    } finally {
      await hub.dispose();
    }
  }, 240_000);
});

describe('integration hub session recovery', () => {
  it('returns sync error details instead of generic NOT_CONNECTED when MCP fails to start', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agentx-int-session-'));
    const hub = new IntegrationHub({ baseDir, redirectBaseUrl: 'http://127.0.0.1:3333' });
    try {
      const provider = createCustomProvider('Broken MCP');
      provider.server = { type: 'stdio', command: '/nonexistent-command-agentx', args: [] };
      const connection = await hub.connectCustom(provider, { authMode: 'none' });
      expect(connection.status).toBe('error');

      const result = await hub.runStoreTool(connection.id, 'test_tool');
      expect(result.error).toBe('NOT_CONNECTED');
      expect(result.output).not.toBe('Integration is not connected');
      expect(result.output.length).toBeGreaterThan('Integration is not connected'.length);
    } finally {
      await hub.dispose();
    }
  });
});

describe('stdio args expansion', () => {
  it('expands ${HOME} in filesystem provider args', () => {
    const expanded = expandStdioArgs(['-y', '@modelcontextprotocol/server-filesystem', '${HOME}']);
    expect(expanded[2]).not.toContain('${HOME}');
    expect(expanded[2]?.length).toBeGreaterThan(1);
  });
});

describe('integration structured results', () => {
  it('parses JSON issue results', () => {
    const structured = parseIntegrationStructuredResult(
      'integration__github__create_issue',
      JSON.stringify({ title: 'Bug fix', number: 42, state: 'open', url: 'https://github.com/o/r/issues/42' }),
    );
    expect(structured?.resultType).toBe('issue');
    expect(structured?.title).toBe('Bug fix');
    expect(structured?.fields.length).toBeGreaterThan(0);
  });
});
