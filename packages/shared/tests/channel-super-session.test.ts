import { describe, it, expect } from 'vitest';
import {
  CHANNEL_SESSION_ID,
  isSuperSessionId,
  resolveFleetToolSessionScope,
} from '../src/utils/channel-session.js';

describe('channel super session utils', () => {
  it('treats __channel__ as a super session', () => {
    expect(isSuperSessionId(CHANNEL_SESSION_ID)).toBe(true);
    expect(isSuperSessionId('abc-123')).toBe(false);
  });

  it('drops session filter for fleet tools on super sessions', () => {
    expect(resolveFleetToolSessionScope(CHANNEL_SESSION_ID)).toBeUndefined();
    expect(resolveFleetToolSessionScope('session-1')).toBe('session-1');
  });
});
