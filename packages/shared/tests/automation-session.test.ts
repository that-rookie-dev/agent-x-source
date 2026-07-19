import { describe, it, expect } from 'vitest';
import {
  automationRunSessionId,
  isAutomationSessionId,
  automationTaskIdFromSessionId,
  isUserFacingSession,
} from '../src/utils/automation-session.js';

describe('automation-session utils', () => {
  it('round-trips task id in run session id', () => {
    const taskId = 'cef64bf6-af9a-4806-9ad5-c6091d0a65f0';
    const sid = automationRunSessionId(taskId);
    expect(sid).toBe(`automation:${taskId}`);
    expect(isAutomationSessionId(sid)).toBe(true);
    expect(automationTaskIdFromSessionId(sid)).toBe(taskId);
  });

  it('excludes automation runs from user-facing sessions', () => {
    expect(isUserFacingSession({ id: 'abc-123', contextKind: 'agent_x' })).toBe(true);
    expect(isUserFacingSession({ id: automationRunSessionId('t1'), contextKind: 'automation' })).toBe(false);
    expect(isUserFacingSession({ id: '__channel__', contextKind: 'agent_x' })).toBe(false);
    expect(isUserFacingSession({ id: 'voice:abc-123', contextKind: 'crew_private' })).toBe(false);
  });
});
