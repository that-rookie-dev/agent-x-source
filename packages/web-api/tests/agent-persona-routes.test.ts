import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const mockGet = vi.fn();
const mockSave = vi.fn();
const mockApplyPersona = vi.fn();

vi.mock('@agentx/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/engine')>();
  return {
    ...actual,
    getPersonaStore: () => ({
      get: mockGet,
      save: mockSave,
    }),
  };
});

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(() => ({ agent: { applyPersona: mockApplyPersona } })),
  awaitEngineStorageReady: vi.fn().mockResolvedValue(undefined),
  getAutonomyStatus: vi.fn(),
}));

import { createAgentRouter } from '../src/routes/legacy/agent.js';

const app = express();
app.use(express.json());
app.use(createAgentRouter());

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

describe('GET/PUT /api/agent/persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue({
      name: 'Agent-X',
      description: 'Default',
      communicationStyle: 'direct',
      decisionMaking: 'balanced',
      domainContext: 'general',
      traits: [],
    });
  });

  it('GET returns persona from PersonaStore', async () => {
    const res = await fetch(`${baseUrl}/api/agent/persona`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Agent-X');
    expect(mockGet).toHaveBeenCalled();
  });

  it('PUT saves persona and applies to running agent', async () => {
    const res = await fetch(`${baseUrl}/api/agent/persona`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'FRIDAY',
        description: 'Updated',
        communicationStyle: 'casual',
        decisionMaking: 'aggressive',
        domainContext: 'Testing',
        traits: ['Fast'],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'FRIDAY' }));
    expect(mockApplyPersona).toHaveBeenCalledWith(expect.objectContaining({ name: 'FRIDAY' }));
  });
});
