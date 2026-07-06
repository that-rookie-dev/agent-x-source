import { describe, expect, it } from 'vitest';
import { createRulesSection } from '../src/secret-sauce/prompt-assembly/sections.js';

describe('createRulesSection audience tone', () => {
  it('default Agent-X rules favor plain language over script tutorials', () => {
    const rules = createRulesSection().load();
    expect(rules).toContain('AUDIENCE & TONE');
    expect(rules).toContain('quantum computing');
    expect(rules).not.toContain('SCRIPT EXECUTION');
  });

  it('crew worker rules keep technical script execution guidance', () => {
    const rules = createRulesSection({ technicalExecutor: true }).load();
    expect(rules).toContain('SCRIPT EXECUTION');
    expect(rules).not.toContain('AUDIENCE & TONE');
  });
});
