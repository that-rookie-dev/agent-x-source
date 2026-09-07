import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpDownload } from '../../src/tools/builtin/web.js';
import { configureHttpKeepAlive } from '../../src/utils/http-agents.js';
import type { ToolExecutionContext } from '@agentx/shared';

describe('httpDownload keeps-alive redirect integration', () => {
  let server: Server;
  let baseUrl: string;
  let scope: string;

  beforeAll(async () => {
    // Simulate the runtime condition: keep-alive agent replaces global fetch.
    configureHttpKeepAlive();

    scope = mkdtempSync(join(tmpdir(), 'http-download-redirect-'));

    const finalPath = '/final.bin';
    const redirectPath = '/model.bin';

    server = createServer((req, res) => {
      if (req.url === redirectPath) {
        res.writeHead(302, { Location: `${baseUrl}${finalPath}` });
        res.end('Moved');
        return;
      }
      if (req.url === finalPath) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '12' });
        res.end('hello world!');
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          // Use a hostname that resolves to 127.0.0.1 but does not start with the 127. SSRF pattern.
          baseUrl = `http://a.127.0.0.1.nip.io:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('follows a 302 redirect even after configureHttpKeepAlive replaced global fetch', async () => {
    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: `${baseUrl}/model.bin`, output: 'model.bin' }, ctx);
    expect(result.success).toBe(true);
    expect(readFileSync(join(scope, 'model.bin'), 'utf-8')).toBe('hello world!');
  });
});
