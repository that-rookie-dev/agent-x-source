import { describe, it, expect } from 'vitest';
import { SkillActivator } from '../../src/synthetic/SkillActivator.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { SkillCapability } from '@agentx/shared';

const now = Date.now();
const skill = (name: string, trigger: string, status: SkillCapability['status'] = 'registered'): SkillCapability => ({
  id: `cap_${name}`, kind: 'skill', name, description: name, createdAt: now, updatedAt: now,
  createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status,
  useCount: 0, trialCount: 0, promptTemplate: `Do ${name}`, triggerPattern: trigger, exampleCalls: [],
});

describe('SkillActivator', () => {
  it('injects registered skills whose trigger matches the message', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(skill('meeting-notes', 'meeting|transcript'));
    const activator = new SkillActivator(store);
    const block = await activator.activateForMessage('Please format this meeting transcript');
    expect(block).toContain('Do meeting-notes');
    expect(block).toContain('not an Executable Skill');
  });

  it('ignores unregistered skills', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(skill('draft', 'draft', 'proposed'));
    const activator = new SkillActivator(store);
    expect(await activator.activateForMessage('draft this')).toBeNull();
  });
});
