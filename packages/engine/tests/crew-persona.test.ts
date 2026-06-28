import { describe, it, expect } from 'vitest';
import { buildCrewVoiceBlock, buildCrewScopeBlock } from '../src/agent/crew-persona.js';
import { buildCrewWorkerSystemPrompt } from '../src/agent/crew-tools.js';
import type { Crew } from '@agentx/shared';

function mockCrew(emotion: Crew['emotion']): Crew {
  return {
    id: 'c1',
    name: 'Alex Chen',
    callsign: 'alex_chen',
    systemPrompt: 'DevOps engineer.',
    emotion,
    isDefault: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('buildCrewVoiceBlock', () => {
  it('includes witty voice guidance', () => {
    const block = buildCrewVoiceBlock(mockCrew('witty'));
    expect(block).toContain('VOICE — witty');
    expect(block).toContain('Alex Chen');
    expect(block).toContain('humor');
  });

  it('returns empty when no emotion set', () => {
    expect(buildCrewVoiceBlock(mockCrew(undefined))).toBe('');
  });
});

describe('buildCrewScopeBlock', () => {
  it('scopes the crew to its profession and warns tool access is not expertise', () => {
    const crew = mockCrew('professional');
    crew.title = 'Neurology Educator';
    const block = buildCrewScopeBlock(crew);
    expect(block).toContain('PROFESSIONAL SCOPE');
    expect(block).toContain('Neurology Educator');
    expect(block).toContain('having a tool available does NOT mean');
    expect(block.toLowerCase()).toContain('outside your field');
  });
});

describe('buildCrewWorkerSystemPrompt', () => {
  it('carries the professional-scope guard into delegated mission workers', () => {
    const prompt = buildCrewWorkerSystemPrompt(mockCrew('professional'));
    expect(prompt).toContain('[CREW_IDENTITY]');
    expect(prompt).toContain('PROFESSIONAL SCOPE');
    expect(prompt).toContain('having a tool available does NOT mean');
  });
});
