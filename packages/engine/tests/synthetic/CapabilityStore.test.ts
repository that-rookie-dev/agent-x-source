import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { SkillCapability } from '@agentx/shared';

function skill(name = 'log-formatter'): SkillCapability {
  const now = Date.now();
  return {
    id: `cap_${name}`,
    kind: 'skill',
    name,
    description: 'Format logs',
    createdAt: now,
    updatedAt: now,
    createdBy: 'test',
    sourceSessionId: 's1',
    version: 1,
    origin: 'user-prompt',
    userPrompt: 'format logs',
    status: 'proposed',
    useCount: 0,
    trialCount: 0,
    promptTemplate: 'Format log lines consistently',
    triggerPattern: 'log',
    exampleCalls: [],
  };
}

describe('InMemoryCapabilityStore', () => {
  let store: InMemoryCapabilityStore;

  beforeEach(() => {
    store = new InMemoryCapabilityStore();
  });

  it('inserts and retrieves a capability', async () => {
    await store.insertCapability(skill());
    const got = await store.getCapability('cap_log-formatter');
    expect(got?.name).toBe('log-formatter');
    expect(got?.kind).toBe('skill');
  });

  it('updates status', async () => {
    await store.insertCapability(skill());
    await store.updateCapabilityStatus('cap_log-formatter', 'registered');
    expect((await store.getCapability('cap_log-formatter'))?.status).toBe('registered');
  });

  it('queries by status and kind', async () => {
    await store.insertCapability(skill('a'));
    await store.insertCapability({ ...skill('b'), id: 'cap_b', status: 'registered' });
    expect((await store.getCapabilities('proposed', 'skill')).map((c) => c.name)).toEqual(['a']);
  });

  it('deduplicates observations by pattern text', async () => {
    await store.insertObservation({
      id: 'o1', pattern: 'repeat shell', frequency: 1, firstObservedAt: 1, lastObservedAt: 1,
      context: 'a', confidence: 0.4, origin: 'autonomous',
    });
    await store.insertObservation({
      id: 'o2', pattern: 'repeat shell', frequency: 1, firstObservedAt: 2, lastObservedAt: 2,
      context: 'b', confidence: 0.9, origin: 'autonomous',
    });
    const obs = await store.getObservations();
    expect(obs).toHaveLength(1);
    expect(obs[0]?.frequency).toBe(2);
    expect(obs[0]?.confidence).toBe(0.9);
  });

  it('stores audit events', async () => {
    await store.insertCapability(skill());
    await store.insertAuditEvent({
      id: 'e1', capabilityId: 'cap_log-formatter', event: 'proposed', timestamp: 1, actor: 'user', details: {},
    });
    expect(await store.getAuditEvents('cap_log-formatter')).toHaveLength(1);
  });

  it('paginates', async () => {
    await store.insertCapability(skill('one'));
    await store.insertCapability({ ...skill('two'), id: 'cap_two' });
    const page = await store.getCapabilities(undefined, undefined, 1, 0);
    expect(page).toHaveLength(1);
  });

  it('rejects duplicate names', async () => {
    await store.insertCapability(skill());
    await expect(store.insertCapability({ ...skill(), id: 'other' })).rejects.toThrow(/already exists/);
  });

  it('scales to 200 capabilities and queries in under 100ms', async () => {
    for (let i = 0; i < 200; i++) {
      await store.insertCapability({
        ...skill(`s-${i}`),
        id: `cap_s-${i}`,
        status: i % 2 === 0 ? 'registered' : 'proposed',
      });
    }
    const start = performance.now();
    const all = await store.getCapabilities('registered', undefined, 200, 0);
    const elapsed = performance.now() - start;
    expect(all.length).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(100);
  });

  it('allows concurrent readers', async () => {
    await store.insertCapability(skill());
    const rows = await Promise.all(Array.from({ length: 20 }, () => store.getCapability('cap_log-formatter')));
    expect(rows.every((r) => r?.name === 'log-formatter')).toBe(true);
  });
});
