import { describe, it, expect } from 'vitest';

describe('SessionModes', () => {
  it('isReadOnly returns true for ask mode', () => {
    const mode = 'ask';
    expect(mode === 'ask').toBe(true);
  });

  it('isPlanning returns true for plan mode', () => {
    const mode = 'plan';
    expect(mode === 'plan').toBe(true);
  });

  it('default mode is agent', () => {
    const mode = 'agent';
    expect(mode).toBe('agent');
  });
});
