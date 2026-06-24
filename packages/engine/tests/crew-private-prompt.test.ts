import { describe, it, expect } from 'vitest';
import { buildCrewPrivateIdentityPrompt } from '../src/agent/CrewOrchestrator.js';
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
    expect(prompt).toContain('not as Agent-X');
  });
});
