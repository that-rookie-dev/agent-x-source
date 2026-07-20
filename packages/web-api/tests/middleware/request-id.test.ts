import { describe, it, expect } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';

const app = express();
app.use(requestIdMiddleware);
app.get('/test', (req, res) => {
  res.json({ requestId: req.requestId, header: res.getHeader('X-Request-Id') });
});

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('request-id middleware', () => {
  it('generates an X-Request-Id header when none is provided', async () => {
    const res = await fetch(`${baseUrl}/test`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('preserves an existing X-Request-Id header', async () => {
    const res = await fetch(`${baseUrl}/test`, { headers: { 'X-Request-Id': 'existing-123' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(res.headers.get('x-request-id')).toBe('existing-123');
    expect(body.requestId).toBe('existing-123');
  });
});
