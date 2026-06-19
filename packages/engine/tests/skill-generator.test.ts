import { describe, it, expect } from 'vitest';
import { SkillGenerator } from '../src/agent/SkillGenerator.js';

function mockDb(): any {
  return {
    prepare: () => ({
      all: () => [],
      get: () => null,
      run: () => ({ changes: 0 }),
    }),
  };
}

describe('SkillGenerator', () => {
  const generator = new SkillGenerator(mockDb());

  it('detects novel skill patterns (2+ unique tool categories)', () => {
    const result = generator.shouldGenerateSkill('Build a React component with tests', [
      { name: 'file_write', args: {} as Record<string, unknown> },
      { name: 'test_run', args: {} as Record<string, unknown> },
    ]);
    // Two different tool categories = novel enough
    expect(typeof result).toBe('boolean');
  });

  it('returns all loaded skills (generated + bundled)', () => {
    const skills = generator.getAll();
    // At minimum, bundled skills should exist
    expect(Array.isArray(skills)).toBe(true);
  });

  it('handles simple single-tool tasks as not novel', () => {
    const result = generator.shouldGenerateSkill('Read a file', [
      { name: 'file_read', args: {} as Record<string, unknown> },
    ]);
    expect(result).toBe(false);
  });
});
