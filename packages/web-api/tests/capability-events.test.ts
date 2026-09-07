import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import http, { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerCapabilityEventRoutes, emitCapabilitySse } from '../src/capability-events.js';

const app = express();
registerCapabilityEventRoutes(app);
const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('capability events SSE', () => {
  it('serves an event stream and broadcasts events', async () => {
    const req = await new Promise<IncomingMessage>((resolve, reject) => {
      const r = http.get(`${baseUrl}/api/events/capabilities`, { timeout: 5000 }, resolve);
      r.on('error', reject);
    });

    expect(req.statusCode).toBe(200);
    expect(req.headers['content-type']).toBe('text/event-stream');
    expect(req.headers['connection']).toBe('keep-alive');

    const chunks: Buffer[] = [];
    let ended = false;
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => { ended = true; });

    // Wait for initial : connected
    await new Promise((resolve) => setTimeout(resolve, 50));
    emitCapabilitySse({ event: 'capability:proposed', capabilityId: 'c1', name: 'demo' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const text = Buffer.concat(chunks).toString('utf-8');
    expect(text).toContain(': connected');
    expect(text).toContain('event: capability:proposed');
    expect(text).toContain('"capabilityId":"c1"');

    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ended).toBe(false);
  });
});
