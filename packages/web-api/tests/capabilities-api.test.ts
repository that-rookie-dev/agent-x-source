import { describe, it, expect, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const mockCapabilities: Array<{ id: string; name: string; kind: string; status: string; origin: string }> = [
  { id: 'c1', name: 'alpha', kind: 'tool', status: 'proposed', origin: 'observed' },
  { id: 'c2', name: 'beta', kind: 'skill', status: 'registered', origin: 'user-prompt' },
];

const mockMgr = {
  getSettings: () => ({ enabled: false, generationConsent: 'unset', sandboxMode: 'process' }),
  health: () => ({
    store: 'memory',
    sandbox: 'process',
    generator: 'heuristic',
    enabled: false,
    consent: 'unset',
    alerts: [],
    metrics: { generationsTotal: 0, sandboxRunsTotal: 0, observationsTotal: 0, errorsTotal: 0 },
  }),
  store: {
    getCapabilities: vi.fn(async (status?: string) => mockCapabilities.filter((c) => !status || c.status === status).map(toolify)),
    getStats: vi.fn(async () => ({ total: 2, byStatus: { proposed: 1, registered: 1 }, byKind: { tool: 1, skill: 1 } })),
    searchCapabilities: vi.fn(async () => []),
  },
  getObservations: async () => [{ id: 'o1', pattern: 'repeated tool shell_exec', frequency: 3, confidence: 0.8, ignored: false }],
  getActiveToolCount: async () => 1,
  getActiveSkillCount: async () => 1,
  getCapability: vi.fn(async (id: string) => mockCapabilities.find((c) => c.id === id) || null),
  getAuditLog: vi.fn(async () => []),
  getUsageReport: vi.fn(async () => null),
  graduator: { getGates: vi.fn(async () => []) },
  setConfig: vi.fn(),
  applyRuntimeFlags: vi.fn(async () => undefined),
  generateFromUserPrompt: vi.fn(async () => ({ proposedCapability: { id: 'c1', name: 'demo' } })),
  generateCapability: vi.fn(async (patternId: string) => ({ proposedCapability: { id: 'c3', name: patternId } })),
  acknowledgeObservation: vi.fn(async () => undefined),
  ignoreObservation: vi.fn(async () => undefined),
  runSandbox: vi.fn(async (id: string) => ({ passed: true, capability: { id } })),
  approveForTrial: vi.fn(async (id: string) => { const c = mockCapabilities.find(c => c.id === id); if (c) c.status = 'in-trial'; }),
  approveForRegistration: vi.fn(async (id: string) => { const c = mockCapabilities.find(c => c.id === id); if (c) c.status = 'registered'; }),
  rejectCapability: vi.fn(async (id: string) => { const c = mockCapabilities.find(c => c.id === id); if (c) c.status = 'archived'; }),
  enableCapability: vi.fn(async (id: string) => {
    const c = mockCapabilities.find((x) => x.id === id);
    if (c?.status !== 'disabled') throw new (await import('@agentx/engine')).CapabilityGraduationError('Only disabled capabilities can be re-enabled');
    c.status = 'registered';
  }),
  archiveCapability: vi.fn(async () => undefined),
  disableCapability: vi.fn(async () => undefined),
  rollbackCapability: vi.fn(async () => undefined),
  saveTestCase: vi.fn(async () => ({ id: 'tc1' })),
  listTestCases: vi.fn(async () => []),
  generator: { clarifyUserPrompt: async () => ({ questions: ['What input?'], inferredKind: 'tool' }) },
};

function toolify(c: { id: string; name: string; kind: string; status: string; origin: string }) {
  return { ...c, createdAt: Date.now(), updatedAt: Date.now(), createdBy: 't', sourceSessionId: '', version: 1, useCount: 0, trialCount: 0 };
}

vi.mock('@agentx/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/engine')>();
  return {
    ...actual,
    getRuntimeCapabilityManager: () => mockMgr,
  };
});

vi.mock('../src/engine.js', () => ({
  getEngine: () => ({
    pgPool: {},
    configManager: {
      load: () => ({ syntheticIntelligence: { enabled: false } }),
      save: vi.fn(),
    },
  }),
  awaitStorageForApi: async () => undefined,
  awaitSiManager: async () => mockMgr,
}));

vi.mock('../src/capability-events.js', () => ({
  attachCapabilityEventBridge: vi.fn(),
  registerCapabilityEventRoutes: vi.fn(),
}));

import { registerCapabilityRoutes } from '../src/capabilities-api.js';

const app = express();
app.use(express.json());
registerCapabilityRoutes(app);
const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('capabilities API', () => {
  it('lists capabilities and settings', async () => {
    const list = await fetch(`${baseUrl}/api/capabilities`);
    expect(list.status).toBe(200);
    const body = await list.json() as { capabilities: unknown[]; stats: { total: number } };
    expect(body.capabilities.length).toBe(2);
    expect(body.stats.total).toBe(2);

    const settings = await fetch(`${baseUrl}/api/capabilities/settings`);
    expect(settings.status).toBe(200);
    const s = await settings.json() as { settings: { sandboxMode: string } };
    expect(s.settings.sandboxMode).toBe('process');
  });

  it('filters capabilities by status and returns stats', async () => {
    const proposed = await fetch(`${baseUrl}/api/capabilities?status=proposed`);
    expect(proposed.status).toBe(200);
    const body = await proposed.json() as { capabilities: { id: string; status: string }[]; stats: { total: number } };
    expect(body.capabilities.every((c) => c.status === 'proposed')).toBe(true);
    expect(body.stats.total).toBe(2);

    const stats = await fetch(`${baseUrl}/api/capabilities/stats`);
    expect(stats.status).toBe(200);
    const s = await stats.json() as { tools: number; skills: number; pendingApprovals: number };
    expect(s.tools).toBe(1);
    expect(s.skills).toBe(1);
    expect(s.pendingApprovals).toBe(1);
  });

  it('returns 404 for unknown capability and 400 for invalid test request', async () => {
    const unknown = await fetch(`${baseUrl}/api/capabilities/nope`);
    expect(unknown.status).toBe(404);

    const badTest = await fetch(`${baseUrl}/api/capabilities/c2/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(badTest.status).toBe(400);
  });

  it('approves, rejects, runs sandbox, and generates from observations', async () => {
    const approve = await fetch(`${baseUrl}/api/capabilities/c1/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gate: 'registration' }) });
    expect(approve.status).toBe(200);

    const trial = await fetch(`${baseUrl}/api/capabilities/c1/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gate: 'trial' }) });
    expect(trial.status).toBe(200);

    const sandbox = await fetch(`${baseUrl}/api/capabilities/c1/sandbox`, { method: 'POST' });
    expect(sandbox.status).toBe(200);

    const gen = await fetch(`${baseUrl}/api/capabilities/observed/o1/generate`, { method: 'POST' });
    expect(gen.status).toBe(200);

    const ack = await fetch(`${baseUrl}/api/capabilities/observed/o1/acknowledge`, { method: 'POST' });
    expect(ack.status).toBe(200);

    const reject = await fetch(`${baseUrl}/api/capabilities/c1/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'no' }) });
    expect(reject.status).toBe(200);
  });

  it('accepts all consent values', async () => {
    for (const value of ['unset', 'once', 'always', 'deny', 'deny-permanently']) {
      const r = await fetch(`${baseUrl}/api/capabilities/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generationConsent: value }) });
      expect(r.status).toBe(200);
    }
    const invalid = await fetch(`${baseUrl}/api/capabilities/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generationConsent: 'maybe' }) });
    expect(invalid.status).toBe(400);
  });

  it('clarifies and records consent', async () => {
    const clarify = await fetch(`${baseUrl}/api/capabilities/generate/clarify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'csv to json' }),
    });
    expect(clarify.status).toBe(200);
    const q = await clarify.json() as { questions: string[] };
    expect(q.questions.length).toBeGreaterThan(0);

    const consent = await fetch(`${baseUrl}/api/capabilities/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationConsent: 'always' }),
    });
    expect(consent.status).toBe(200);

    const metrics = await fetch(`${baseUrl}/api/capabilities/metrics`);
    expect(metrics.status).toBe(200);
  });
});
