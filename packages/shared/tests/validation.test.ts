import { describe, it, expect } from 'vitest';
import { providerIdSchema, permissionDecisionSchema, sessionStatusSchema, toolRiskLevelSchema } from '../src/utils/validation.js';

describe('providerIdSchema', () => {
  it('accepts valid provider IDs', () => {
    expect(providerIdSchema.parse('openai')).toBe('openai');
    expect(providerIdSchema.parse('anthropic')).toBe('anthropic');
    expect(providerIdSchema.parse('google')).toBe('google');
    expect(providerIdSchema.parse('ollama')).toBe('ollama');
    expect(providerIdSchema.parse('lmstudio')).toBe('lmstudio');
  });

  it('rejects invalid provider IDs', () => {
    expect(() => providerIdSchema.parse('invalid')).toThrow();
    expect(() => providerIdSchema.parse('')).toThrow();
  });
});

describe('permissionDecisionSchema', () => {
  it('accepts valid decisions', () => {
    expect(permissionDecisionSchema.parse('allow_once')).toBe('allow_once');
    expect(permissionDecisionSchema.parse('allow_always')).toBe('allow_always');
    expect(permissionDecisionSchema.parse('deny')).toBe('deny');
  });

  it('rejects invalid decisions', () => {
    expect(() => permissionDecisionSchema.parse('maybe')).toThrow();
  });
});

describe('sessionStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(sessionStatusSchema.parse('active')).toBe('active');
    expect(sessionStatusSchema.parse('completed')).toBe('completed');
    expect(sessionStatusSchema.parse('paused')).toBe('paused');
    expect(sessionStatusSchema.parse('archived')).toBe('archived');
  });

  it('rejects invalid statuses', () => {
    expect(() => sessionStatusSchema.parse('deleted')).toThrow();
  });
});

describe('toolRiskLevelSchema', () => {
  it('accepts valid risk levels', () => {
    expect(toolRiskLevelSchema.parse('low')).toBe('low');
    expect(toolRiskLevelSchema.parse('medium')).toBe('medium');
    expect(toolRiskLevelSchema.parse('high')).toBe('high');
    expect(toolRiskLevelSchema.parse('critical')).toBe('critical');
  });

  it('rejects invalid levels', () => {
    expect(() => toolRiskLevelSchema.parse('unknown')).toThrow();
  });
});
