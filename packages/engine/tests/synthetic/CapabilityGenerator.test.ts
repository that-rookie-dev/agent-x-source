import { describe, it, expect } from 'vitest';
import { DefaultCapabilityGenerator } from '../../src/synthetic/CapabilityGenerator.js';
import type { ObservedPattern } from '@agentx/shared';

const pattern: ObservedPattern = {
  id: 'obs1',
  pattern: 'create a reusable skill that summarizes meeting notes into bullets',
  frequency: 1,
  firstObservedAt: 1,
  lastObservedAt: 1,
  context: 'meeting notes',
  confidence: 1,
  origin: 'user-prompt',
};

describe('DefaultCapabilityGenerator', () => {
  it('parses valid skill JSON from the LLM', async () => {
    const gen = new DefaultCapabilityGenerator(async () => JSON.stringify({
      name: 'meeting-summary',
      description: 'Summarize notes',
      promptTemplate: 'Turn notes into bullets',
      triggerPattern: 'meeting|notes',
      exampleCalls: ['summarize these notes'],
    }));
    const skill = await gen.generateSkill(pattern);
    expect(skill?.name).toBe('meeting-summary');
    expect(skill?.origin).toBe('user-prompt');
    expect(skill?.promptTemplate).toContain('bullets');
  });

  it('retries invalid JSON then succeeds', async () => {
    let n = 0;
    const gen = new DefaultCapabilityGenerator(async () => {
      n += 1;
      if (n === 1) return 'not json';
      return JSON.stringify({
        name: 'ok-skill',
        description: 'ok',
        promptTemplate: 'do it',
        triggerPattern: 'ok',
        exampleCalls: [],
      });
    });
    const skill = await gen.generateSkill(pattern);
    expect(skill?.name).toBe('ok-skill');
    expect(n).toBe(2);
  });

  it('falls back to a heuristic skill without an LLM', async () => {
    const gen = new DefaultCapabilityGenerator(null);
    const skill = await gen.generateSkill(pattern);
    expect(skill?.kind).toBe('skill');
    expect(skill?.promptTemplate).toBe(pattern.pattern);
  });

  it('asks clarifying questions for vague prompts', async () => {
    const gen = new DefaultCapabilityGenerator(null);
    const result = await gen.clarifyUserPrompt('do it');
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('classifies convert/csv prompts as tools', async () => {
    const gen = new DefaultCapabilityGenerator(null);
    const result = await gen.clarifyUserPrompt('create a tool that converts CSV to JSON with these columns');
    expect(result.inferredKind === 'tool' || result.inferredKind === 'auto').toBe(true);
  });

  it('validates typescript braces', () => {
    const gen = new DefaultCapabilityGenerator(null);
    expect(gen.validateTypeScript('function run(a) { return a; }').valid).toBe(true);
    expect(gen.validateTypeScript('function run(a) { return a;').valid).toBe(false);
  });

  it('detects network side effects', () => {
    const gen = new DefaultCapabilityGenerator(null);
    expect(gen.detectSideEffects('await fetch(url)', 'typescript')).toContain('network');
    expect(gen.estimateRisk('await fetch(url)', 'typescript')).toBe('high');
  });

  it('generates an alternative tool from feedback', async () => {
    const gen = new DefaultCapabilityGenerator(async () => JSON.stringify({
      name: 'csv-json',
      description: 'better csv',
      language: 'javascript',
      sourceCode: 'function run(args){ return { ok: true }; }',
      entryPoint: 'run',
    }));
    const tool = await gen.generateTool(pattern);
    expect(tool).toBeTruthy();
    const alt = await gen.generateAlternative(tool!, 'return objects not strings');
    expect(alt.sourceCode).toContain('ok');
    expect(alt.version).toBe((tool!.version) + 1);
  });

  it('returns null for tools after max retries of invalid JSON', async () => {
    const gen = new DefaultCapabilityGenerator(async () => 'not json');
    await expect(gen.generateTool(pattern)).resolves.toBeNull();
  });

  it('times out a hung LLM call', async () => {
    const gen = new DefaultCapabilityGenerator(() => new Promise(() => undefined), 40);
    await expect(gen.generateTool(pattern)).resolves.toBeNull();
  });
});
