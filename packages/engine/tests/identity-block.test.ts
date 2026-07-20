import { describe, it, expect } from 'vitest';
import { buildIdentityBlock } from '../src/agent/agent-helpers.js';
import { createIdentitySection } from '../src/prompt/assembly/sections.js';

describe('buildIdentityBlock', () => {
  it('reflects saved persona name, description, and traits', () => {
    const block = buildIdentityBlock({
      persona: {
        name: 'FRIDAY',
        description: 'Personal assistant on your machine.',
        communicationStyle: 'direct',
        decisionMaking: 'balanced',
        domainContext: 'Home automation',
        traits: ['Precise', 'Calm'],
      },
      options: {},
    });

    expect(block).toContain('You are FRIDAY');
    expect(block).toContain('Personal assistant on your machine.');
    expect(block).toContain('Domain: Home automation');
    expect(block).toContain('Traits: Precise, Calm');
    expect(block).not.toContain('interactionCount');
    expect(block).not.toContain('evolutionLog');
  });
});

describe('createIdentitySection', () => {
  it('wraps identity block with [IDENTITY] tags', () => {
    const section = createIdentitySection({
      buildIdentityBlock: () => 'You are CORTANA, an AI agent running on the user\'s own machine.',
      getPersona: () => ({
        name: 'CORTANA',
        description: '',
        communicationStyle: 'direct',
        decisionMaking: 'balanced',
        domainContext: 'general',
        traits: [],
      }),
    } as never);

    const content = section.load();
    const rendered = section.render!(content);
    expect(rendered).toContain('[IDENTITY]');
    expect(rendered).toContain('You are CORTANA');
    expect(rendered).toContain('[/IDENTITY]');
  });
});
