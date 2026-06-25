import { describe, it, expect } from 'vitest';
import {
  assessCrewNeed,
  autoComposeCrewMembers,
  buildTaskContextForCrewRouting,
  hasTaskSignals,
  isActiveCrewContinuation,
  isDistinctNewRequirement,
  shouldBypassActiveCrewRouting,
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

  it('merges prior context when user defers planning to the agent', () => {
    const context = buildTaskContextForCrewRouting(
      'plan it yourself',
      ['I would like to plan a beach vacation with my wife and baby'],
    );
    expect(context).toContain('beach vacation');
    expect(context).toContain('plan it yourself');
  });

  it('merges prior context for uncertain follow-ups', () => {
    const context = buildTaskContextForCrewRouting(
      'I am not sure, can you suggest me a best plan. This is kind of a surprise for my family.',
      ['I would like to plan for a vacation with my wife and 4 month old baby girl'],
    );
    expect(context).toContain('vacation');
    expect(context).toContain('not sure');
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

describe('crew suggestion continuation vs new requirement', () => {
  const vacationPrior = ['Plan a surprise beach vacation for my partner in Bali'];

  it('treats deferrals and short follow-ups as continuation', () => {
    expect(isActiveCrewContinuation('plan it yourself', vacationPrior)).toBe(true);
    expect(isActiveCrewContinuation('yes please', vacationPrior)).toBe(true);
  });

  it('detects a distinct new domain in follow-up messages', () => {
    expect(isDistinctNewRequirement(
      'Also help me file my income tax return for freelancers',
      vacationPrior,
    )).toBe(true);
  });

  it('detects AWS workforce requests as distinct from travel context', () => {
    expect(isDistinctNewRequirement(
      'I want crew members who have AWS skills',
      vacationPrior,
    )).toBe(true);
    const context = buildTaskContextForCrewRouting(
      'I want crew members who have AWS skills',
      vacationPrior,
    );
    expect(context).not.toContain('beach vacation');
  });

  it('does not flag same-domain vacation follow-ups as new requirements', () => {
    expect(isDistinctNewRequirement('add scuba diving to the itinerary', vacationPrior)).toBe(false);
  });
});

describe('shouldBypassActiveCrewRouting', () => {
  it('bypasses when user skipped crew suggestion', () => {
    expect(shouldBypassActiveCrewRouting('continue with agent-x', { crewSuggestionResolved: true })).toBe(true);
  });

  it('bypasses workforce and explicit crew searches', () => {
    expect(shouldBypassActiveCrewRouting('I want crew members who have AWS skills')).toBe(true);
    expect(shouldBypassActiveCrewRouting('find a skilled person for kubernetes')).toBe(true);
  });

  it('does not bypass when user deployed crew this turn', () => {
    expect(shouldBypassActiveCrewRouting('deploy them', { hasDelegateCrewIds: true })).toBe(false);
  });
});

describe('travel crew must not answer AWS workforce requests', () => {
  const jonas = mockCrew({
    id: 'jonas-travel',
    name: 'Jonas Park',
    callsign: 'jonas_park',
    systemPrompt: 'Travel planner specializing in itineraries and tourism.',
    expertise: ['travel', 'tourism', 'planning', 'logistics'],
  });

  it('does not route AWS specialist search to travel crew', () => {
    const prior = ['Plan a beach vacation with my family'];
    const task = buildTaskContextForCrewRouting(
      'I want crew members who have AWS skills',
      prior,
    );
    const assessment = assessCrewNeed(task, [mockMember(jonas)]);
    expect(assessment.shouldRoute).toBe(false);
  });
});
