import { describe, it, expect } from 'vitest';
import { buildCrewVoiceBlock } from '../src/agent/crew-persona.js';
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
