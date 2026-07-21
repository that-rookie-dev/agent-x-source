import { describe, expect, it } from 'vitest';
import {
  isUnsupportedToolChoiceError,
  shouldForceNamedToolChoice,
  toolChoiceModelKey,
} from '../src/providers/tool-choice-policy.js';

describe('tool-choice-policy', () => {
  it('allows force when policy wants it and reasoning is off', () => {
    expect(shouldForceNamedToolChoice({
      policyWantsForce: true,
      reasoningEffort: 'none',
    })).toBe(true);
  });

  it('blocks force when extended reasoning effort is active', () => {
    expect(shouldForceNamedToolChoice({
      policyWantsForce: true,
      reasoningEffort: 'high',
    })).toBe(false);
  });

  it('blocks force after a prior unsupported response for that model', () => {
    expect(shouldForceNamedToolChoice({
      policyWantsForce: true,
      reasoningEffort: 'none',
      previouslyUnsupported: true,
    })).toBe(false);
  });

  it('honors explicit catalog denial', () => {
    expect(shouldForceNamedToolChoice({
      policyWantsForce: true,
      supportsForcedToolChoice: false,
    })).toBe(false);
  });

  it('detects generic unsupported tool-choice errors', () => {
    expect(isUnsupportedToolChoiceError(
      new Error('Thinking mode does not support this tool_choice'),
    )).toBe(true);
    expect(isUnsupportedToolChoiceError(
      new Error('invalid_request: tool_choice is unsupported'),
    )).toBe(true);
    expect(isUnsupportedToolChoiceError(new Error('rate limit exceeded'))).toBe(false);
  });

  it('builds a stable model key', () => {
    expect(toolChoiceModelKey('agg', 'vendor/model-a')).toBe('agg::vendor/model-a');
  });
});
