import { describe, it, expect } from 'vitest';
import { isCrewPrivateSessionRecord, buildInstructionForMode } from '../src/chat-helpers.js';

describe('isCrewPrivateSessionRecord', () => {
  it('detects crew private sessions', () => {
    expect(isCrewPrivateSessionRecord({ contextKind: 'crew_private' })).toBe(true);
    expect(isCrewPrivateSessionRecord({ contextKind: 'agent_x' })).toBe(false);
    expect(isCrewPrivateSessionRecord(null)).toBe(false);
    expect(isCrewPrivateSessionRecord(undefined)).toBe(false);
  });
});

describe('buildInstructionForMode crew private', () => {
  it('uses conversational plan instruction without agent mode switch nagging', () => {
    const instruction = buildInstructionForMode('plan', { crewPrivate: true });
    expect(instruction).toContain('markdown IN THIS CHAT');
    expect(instruction).not.toContain('switch to Agent mode or engage Hyperdrive');
    expect(instruction).not.toContain('approval UI');
  });

  it('skips agent diagnostics instruction for crew private agent mode', () => {
    expect(buildInstructionForMode('agent', { crewPrivate: true })).toBeUndefined();
  });
});
