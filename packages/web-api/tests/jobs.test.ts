import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';
import { InMemoryQueue } from '@agentx/engine';

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(),
}));

import { getEngine } from '../src/engine.js';
import { router as jobsRouter } from '../src/routes/jobs.js';
import { ApiService } from '../src/services/ApiService.js';

const api = new ApiService();
const app = express();
app.use(express.json());
app.use('/api/jobs', jobsRouter({ api }));

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('jobs router', () => {
  let queue: InMemoryQueue;

  beforeEach(() => {
    queue = new InMemoryQueue();
    (getEngine as any).mockReturnValue({ jobQueue: queue });
  });

  it('POST /api/jobs enqueues and returns id', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', data: { value: 1 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    const job = await queue.getJob(body.id);
    expect(job?.name).toBe('test');
  });

  it('GET /api/jobs/:id returns the job', async () => {
    const post = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    const { id } = await post.json();
    const res = await fetch(`${baseUrl}/api/jobs/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.id).toBe(id);
  });

  it('DELETE /api/jobs/:id cancels the job', async () => {
    const post = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', opts: { delay: 60000 } }),
    });
    const { id } = await post.json();
    const res = await fetch(`${baseUrl}/api/jobs/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(true);
  });
});
