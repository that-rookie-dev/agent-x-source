import { describe, it, expect } from 'vitest';
import { isCrewPrivateSessionRecord } from '../src/chat-helpers.js';

describe('isCrewPrivateSessionRecord', () => {
  it('detects crew private sessions', () => {
    expect(isCrewPrivateSessionRecord({ contextKind: 'crew_private' })).toBe(true);
    expect(isCrewPrivateSessionRecord({ contextKind: 'agent_x' })).toBe(false);
    expect(isCrewPrivateSessionRecord(null)).toBe(false);
    expect(isCrewPrivateSessionRecord(undefined)).toBe(false);
  });
});
