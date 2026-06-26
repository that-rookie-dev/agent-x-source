import { describe, it, expect, vi } from 'vitest';
import { evaluateCrewDelegation } from '../src/agent/crew-delegation-guard.js';
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
  return { crew, expertise, active: true, tokensUsedThisSession: 0, cpuTimeMs: 0 };
}

describe('evaluateCrewDelegation', () => {
  const sophia = mockCrew({
    id: 'fitness-1',
    name: 'Sophia Laurent',
    callsign: 'sophia_laurent',
    systemPrompt: 'Certified personal trainer and fitness coach.',
    expertise: ['fitness', 'training', 'wellness'],
  });

  const nutrition = mockCrew({
    id: 'nutrition-1',
    name: 'Dr. Rivera',
    callsign: 'nutrition_doc',
    systemPrompt: 'Certified nutritionist for meal planning and macros.',
    expertise: ['nutrition', 'meal planning', 'macros'],
  });

  it('denies when guard LLM returns deny', async () => {
    const complete = vi.fn().mockResolvedValue('deny\nTask is system info Agent-X should handle');
    const result = await evaluateCrewDelegation(
      {
        userMessage: 'can you pull the specs of this system?',
        task: 'pull system hardware specs',
        members: [mockMember(sophia)],
      },
      complete,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Agent-X should respond directly|system info/i);
    expect(complete).not.toHaveBeenCalled();
  });

  it('allows when guard LLM returns allow for clear specialist fit', async () => {
    const complete = vi.fn().mockResolvedValue('allow\nMeal planning is nutrition specialist domain');
    const result = await evaluateCrewDelegation(
      {
        userMessage: 'I need a 7-day meal plan with macros',
        task: 'Create a 7-day meal plan with calorie targets and macro breakdown',
        members: [mockMember(nutrition)],
      },
      complete,
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/nutrition/i);
  });

  it('denies on LLM error (fail closed)', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('model unavailable'));
    const result = await evaluateCrewDelegation(
      {
        userMessage: 'help me deploy kubernetes',
        task: 'deploy app to kubernetes',
        members: [mockMember(sophia)],
      },
      complete,
    );
    expect(result.allowed).toBe(false);
  });

  it('denies when no members provided', async () => {
    const result = await evaluateCrewDelegation(
      { userMessage: 'test', task: 'test', members: [] },
      vi.fn(),
    );
    expect(result.allowed).toBe(false);
  });

  it('denies travel planner for JWST news before calling LLM', async () => {
    const jonas = mockCrew({
      id: 'jonas-travel',
      name: 'Jonas Park',
      callsign: 'jonas_park',
      systemPrompt: 'Adventure Travel Planner.',
      expertise: ['travel', 'tourism'],
    });
    const complete = vi.fn();
    const result = await evaluateCrewDelegation(
      {
        userMessage: 'what is the latest new about James Webb Telescope?',
        task: 'Summarize latest James Webb Telescope news',
        members: [mockMember(jonas)],
      },
      complete,
    );
    expect(result.allowed).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });
});
