import { describe, it, expect } from 'vitest';
import {
  assessCrewNeed,
  autoComposeCrewMembers,
  buildTaskContextForCrewRouting,
  hasTaskSignals,
  shouldSkipAutonomousCrewRouting,
} from '../src/agent/crew-auto-compose.js';
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

function mockMember(crew: Crew, expertise: string[] = crew.expertise ?? []): CrewMember {
  return {
    crew,
    expertise,
    active: true,
    tokensUsedThisSession: 0,
    cpuTimeMs: 0,
  };
}

describe('autoComposeCrewMembers', () => {
  const nutrition = mockCrew({
    id: 'nutrition-1',
    name: 'Dr. Rivera',
    callsign: 'nutrition_doc',
    systemPrompt: 'You are a certified nutritionist specializing in meal planning and macros.',
    description: 'Nutrition and wellness expert',
    expertise: ['nutrition', 'meal planning', 'macros'],
  });

  const devops = mockCrew({
    id: 'devops-1',
    name: 'Alex Chen',
    callsign: 'devops_alex',
    systemPrompt: 'DevOps engineer for Kubernetes and CI/CD pipelines.',
    expertise: ['devops', 'kubernetes', 'docker'],
  });

  const tax = mockCrew({
    id: 'tax-1',
    name: 'Jordan Lee',
    callsign: 'tax_jordan',
    systemPrompt: 'CPA specializing in personal income tax and deductions.',
    expertise: ['tax', 'accounting', 'finance'],
  });

  const members = [mockMember(nutrition), mockMember(devops), mockMember(tax)];

  it('selects nutrition crew for meal-planning tasks', () => {
    const selected = autoComposeCrewMembers(
      'Create a 7-day meal plan with calorie targets and macro breakdown',
      members,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.crew.id).toBe('nutrition-1');
  });

  it('selects devops crew for deployment tasks', () => {
    const selected = autoComposeCrewMembers(
      'Set up Kubernetes deployment with CI/CD for our API',
      members,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.crew.id).toBe('devops-1');
  });

  it('autonomously routes tax tasks without explicit crew mention', () => {
    const assessment = assessCrewNeed('I need help filing my income tax return and maximizing deductions', members);
    expect(assessment.shouldRoute).toBe(true);
    expect(assessment.members[0]!.crew.id).toBe('tax-1');
  });

  it('matches short domain phrases like meal plan', () => {
    const selected = autoComposeCrewMembers('meal plan for weight loss', members);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.crew.id).toBe('nutrition-1');
  });

  it('returns empty when no crew matches strongly enough', () => {
    const selected = autoComposeCrewMembers('Hello, how are you?', members);
    expect(selected).toHaveLength(0);
  });

  it('returns empty for empty roster', () => {
    expect(autoComposeCrewMembers('meal plan', [])).toHaveLength(0);
  });
});

describe('buildTaskContextForCrewRouting', () => {
  it('merges prior user message for short follow-ups', () => {
    const context = buildTaskContextForCrewRouting(
      'make it vegetarian please',
      ['Create a 7-day meal plan with high protein'],
    );
    expect(context).toContain('meal plan');
    expect(context).toContain('vegetarian');
  });

  it('keeps standalone long messages as-is', () => {
    const msg = 'Set up Kubernetes deployment with CI/CD for our API backend service';
    expect(buildTaskContextForCrewRouting(msg, ['older unrelated message about lunch'])).toBe(msg);
  });
});

describe('hasTaskSignals', () => {
  it('detects actionable work requests', () => {
    expect(hasTaskSignals('Can you review my deployment pipeline?')).toBe(true);
  });

  it('rejects pure social messages', () => {
    expect(hasTaskSignals('thanks!')).toBe(false);
  });
});

describe('shouldSkipAutonomousCrewRouting', () => {
  it('skips system spec queries for Agent-X', () => {
    expect(shouldSkipAutonomousCrewRouting('can you pull the specs of this system?')).toBe(true);
  });

  it('skips explicit Agent-X addressing', () => {
    expect(shouldSkipAutonomousCrewRouting('message Agent-X')).toBe(true);
  });

  it('allows specialist meal-planning tasks', () => {
    expect(shouldSkipAutonomousCrewRouting('Create a 7-day meal plan with calorie targets')).toBe(false);
  });
});

describe('system spec follow-up after unrelated prior message', () => {
  const sophia = mockCrew({
    id: 'fitness-1',
    name: 'Sophia Laurent',
    callsign: 'sophia_laurent',
    systemPrompt: 'Certified personal trainer and fitness coach.',
    expertise: ['fitness', 'training', 'wellness'],
  });

  it('does not merge or route specs question to fitness crew', () => {
    const prior = ['which is the best local model for text to speech and speech to text on this machine?'];
    const msg = 'can you pull the specs of this system?';
    expect(shouldSkipAutonomousCrewRouting(msg)).toBe(true);
    const context = buildTaskContextForCrewRouting(msg, prior);
    expect(context).toBe(msg);
    const assessment = assessCrewNeed(context, [mockMember(sophia)]);
    expect(assessment.shouldRoute).toBe(false);
  });
});
