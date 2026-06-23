import { describe, it, expect } from 'vitest';
import {
  detectCrewDelegationIntent,
  resolveNamedCrewMentions,
} from '../src/agent/crew-delegation-intent.js';
import type { CrewMember } from '../src/agent/CrewOrchestrator.js';
import type { Crew } from '@agentx/shared';

function mockCrew(overrides: Partial<Crew> & Pick<Crew, 'id' | 'name' | 'callsign' | 'systemPrompt'>): Crew {
  return {
    isDefault: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockMember(crew: Crew): CrewMember {
  return {
    crew,
    expertise: crew.expertise ?? [],
    active: true,
    tokensUsedThisSession: 0,
    cpuTimeMs: 0,
  };
}

describe('crew-delegation-intent', () => {
  const nutrition = mockCrew({
    id: 'nutrition-1',
    name: 'Dr. Rivera',
    callsign: 'nutrition_doc',
    systemPrompt: 'Nutritionist',
    expertise: ['nutrition'],
  });
  const devops = mockCrew({
    id: 'devops-1',
    name: 'Alex Chen',
    callsign: 'devops_alex',
    systemPrompt: 'DevOps',
    expertise: ['devops'],
  });
  const members = [mockMember(nutrition), mockMember(devops)];

  it('detects involve-the-crew phrasing', () => {
    const intent = detectCrewDelegationIntent('Please involve the crew on this meal plan', members);
    expect(intent.detected).toBe(true);
    expect(intent.involveAll).toBe(true);
    expect(intent.namedMembers).toHaveLength(0);
  });

  it('detects named delegation without @mention', () => {
    const intent = detectCrewDelegationIntent('Have Dr. Rivera create a 7-day meal plan', members);
    expect(intent.detected).toBe(true);
    expect(intent.namedMembers).toHaveLength(1);
    expect(intent.namedMembers[0]!.crew.id).toBe('nutrition-1');
    expect(intent.involveAll).toBe(false);
  });

  it('resolves crew by callsign in natural language', () => {
    const found = resolveNamedCrewMentions('Ask devops_alex to fix the deployment pipeline', members);
    expect(found).toHaveLength(1);
    expect(found[0]!.crew.id).toBe('devops-1');
  });

  it('ignores crew hub / meta questions', () => {
    const intent = detectCrewDelegationIntent('How do I configure crew settings?', members);
    expect(intent.detected).toBe(false);
  });

  it('does not trigger on casual name mention without delegation verb', () => {
    const intent = detectCrewDelegationIntent('Dr. Rivera wrote a great article', members);
    expect(intent.detected).toBe(false);
  });
});
