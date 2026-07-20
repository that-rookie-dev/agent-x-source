import { describe, expect, it } from 'vitest';
import { createRulesSection, createPersonaToneSection } from '../src/prompt/assembly/sections.js';

describe('createRulesSection audience tone', () => {
  it('default Agent-X rules reference dynamic persona tone', () => {
    const rules = createRulesSection().load();
    expect(rules).toContain('AUDIENCE & TONE');
    expect(rules).toContain('[PERSONA TONE]');
    expect(rules).toContain('quantum computing');
    expect(rules).not.toContain('SCRIPT EXECUTION');
  });

  it('crew worker rules keep technical script execution guidance', () => {
    const rules = createRulesSection({ technicalExecutor: true }).load();
    expect(rules).toContain('SCRIPT EXECUTION');
    expect(rules).not.toContain('AUDIENCE & TONE');
  });
});

describe('createPersonaToneSection', () => {
  it('reflects current persona communication style', () => {
    const section = createPersonaToneSection({
      getPersona: () => ({
        name: 'Bahn',
        description: 'Warm travel companion',
        communicationStyle: 'casual',
        decisionMaking: 'balanced',
        domainContext: 'travel',
        traits: ['curious'],
      }),
    } as never);
    const text = section.load();
    expect(text).toContain('Bahn');
    expect(text).toContain('casual');
    expect(text).toContain('conversationally');
  });
});
