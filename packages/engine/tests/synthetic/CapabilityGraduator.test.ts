import { describe, it, expect } from 'vitest';
import { DefaultCapabilityGraduator } from '../../src/synthetic/CapabilityGraduator.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { SkillCapability, ToolCapability } from '@agentx/shared';

const now = Date.now();
const skill: SkillCapability = {
  id: 'cap_s', kind: 'skill', name: 's', description: 'd', createdAt: now, updatedAt: now,
  createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'proposed',
  useCount: 0, trialCount: 0, promptTemplate: 'p', triggerPattern: 't', exampleCalls: [],
};
const tool: ToolCapability = {
  id: 'cap_t', kind: 'tool', name: 't', description: 'd', createdAt: now, updatedAt: now,
  createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'proposed',
  useCount: 0, trialCount: 0, language: 'javascript', sourceCode: 'function run(){return 1}', entryPoint: 'run',
  inputSchema: {}, outputSchema: {}, dependencies: [], sideEffects: [], approvedSideEffects: [], sandboxResult: null,
};

describe('DefaultCapabilityGraduator', () => {
  it('skips sandbox for prompt-recipe skills', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(skill);
    const g = new DefaultCapabilityGraduator(store);
    await g.seedGates(skill);
    const gates = await g.getGates('cap_s');
    expect(gates.find((x) => x.gate === 'sandbox')?.status).toBe('skipped');
    expect(await g.getNextGate('cap_s')).toMatchObject({ gate: 'user-approval', status: 'pending' });
  });

  it('requires sandbox then trial then approval for tools', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool);
    const g = new DefaultCapabilityGraduator(store);
    await g.seedGates(tool);
    expect((await g.getNextGate('cap_t'))?.gate).toBe('sandbox');
    await g.passGate('cap_t', 'sandbox', 'system');
    expect((await g.getNextGate('cap_t'))?.gate).toBe('trial');
    await g.passGate('cap_t', 'trial', 'user');
    expect((await g.getNextGate('cap_t'))?.gate).toBe('user-approval');
    await g.passGate('cap_t', 'user-approval', 'user');
    expect(await g.isEligibleForPromotion('cap_t')).toBe(true);
  });

  it('rejects passing trial before sandbox', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool);
    const g = new DefaultCapabilityGraduator(store);
    await g.seedGates(tool);
    await expect(g.passGate('cap_t', 'trial', 'user')).rejects.toThrow(/Must pass sandbox/);
  });

  it('detects trial expiry by use count', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability({ ...tool, status: 'in-trial', trialCount: 10 });
    const g = new DefaultCapabilityGraduator(store);
    expect(g.isTrialExpired({ ...tool, status: 'in-trial', trialCount: 10 }, 86_400_000, 10)).toBe(true);
  });

  it('failGate lowers matching observation confidence for re-observation', async () => {
    const store = new InMemoryCapabilityStore();
    const prompted = { ...skill, userPrompt: 'summarize meeting notes into bullets' };
    await store.insertCapability(prompted);
    await store.insertObservation({
      id: 'obs1',
      pattern: 'summarize meeting notes into bullets',
      frequency: 3,
      firstObservedAt: now,
      lastObservedAt: now,
      context: 'notes',
      confidence: 0.9,
      origin: 'user-prompt',
      acknowledged: true,
    });
    const g = new DefaultCapabilityGraduator(store);
    await g.seedGates(prompted);
    await g.failGate('cap_s', 'sandbox', 'system', 'sandbox failed');
    const obs = (await store.getObservations(0, { includeIgnored: true }))[0];
    expect(obs?.acknowledged).toBe(false);
    expect(obs?.confidence ?? 1).toBeLessThan(0.9);
  });
});
