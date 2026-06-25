import { describe, it, expect } from 'vitest';
import { buildCrewPrivateIdentityPrompt, buildCrewPrivateFastReplyPrompt } from '../src/agent/CrewOrchestrator.js';
import { createCrewPrivateConductSection, createRulesSection } from '../src/secret-sauce/prompt-assembly/sections.js';
import type { Crew } from '@agentx/shared';

describe('buildCrewPrivateIdentityPrompt', () => {
  const crew: Crew = {
    id: 'crew-1',
    name: 'Elias Vance',
    title: 'Travel Specialist',
    callsign: 'elias_travel',
    systemPrompt: 'You are a travel expert.',
    description: 'Knows every airport lounge.',
    traits: ['curious', 'warm'],
    expertise: ['travel', 'itineraries'],
    emotion: 'friendly',
    enabled: true,
    source: 'custom',
  };

  it('includes crew identity and conversational private-chat instructions', () => {
    const prompt = buildCrewPrivateIdentityPrompt(crew);
    expect(prompt).toContain('Elias Vance');
    expect(prompt).toContain('Travel Specialist');
    expect(prompt).toContain('You are a travel expert');
    expect(prompt).toContain('private 1:1 chat');
    expect(prompt).not.toContain('EXECUTE, not just describe');
    expect(prompt).toContain('not Agent-X');
    expect(prompt).toContain('INTERNAL REFERENCE');
    expect(prompt).not.toContain('use your full capabilities');
  });
});

describe('buildCrewPrivateFastReplyPrompt', () => {
  const crew: Crew = {
    id: 'crew-1',
    name: 'Elias Vance',
    title: 'Travel Specialist',
    callsign: 'elias_travel',
    systemPrompt: 'You are a travel expert.',
    enabled: true,
    source: 'custom',
    emotion: 'friendly',
  };

  it('asks for short natural replies without skill dumps', () => {
    const prompt = buildCrewPrivateFastReplyPrompt(crew);
    expect(prompt).toContain('Elias Vance');
    expect(prompt).toContain('No tools');
    expect(prompt).toContain('No skill lists');
    expect(prompt).toContain('service brochure');
  });
});

describe('createCrewPrivateConductSection', () => {
  it('uses conversational conduct instead of Agent-X autonomous execution rules', () => {
    const conduct = createCrewPrivateConductSection().load();
    const agentRules = createRulesSection().load();
    expect(conduct).toContain('CREW_PRIVATE_CONDUCT');
    expect(conduct).toContain('OUT OF YOUR EXPERTISE');
    expect(conduct).not.toContain('ACT IMMEDIATELY');
    expect(agentRules).toContain('ACT IMMEDIATELY');
  });
});
