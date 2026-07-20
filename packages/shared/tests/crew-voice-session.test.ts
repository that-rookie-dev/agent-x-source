import { describe, it, expect } from 'vitest';
import {
  crewVoiceSessionId,
  isCrewVoiceSessionId,
  textSessionIdFromVoiceSessionId,
} from '../src/utils/crew-voice-session.js';
import { isUserFacingSession } from '../src/utils/automation-session.js';

describe('crew-voice-session utils', () => {
  const textId = 'cef64bf6-af9a-4806-9ad5-c6091d0a65f0';

  it('builds voice:{textSessionId} and round-trips', () => {
    const voiceId = crewVoiceSessionId(textId);
    expect(voiceId).toBe(`voice:${textId}`);
    expect(isCrewVoiceSessionId(voiceId)).toBe(true);
    expect(textSessionIdFromVoiceSessionId(voiceId)).toBe(textId);
    expect(crewVoiceSessionId(voiceId)).toBe(voiceId);
  });

  it('excludes voice sessions from user-facing session lists', () => {
    expect(isUserFacingSession({ id: textId, contextKind: 'crew_private' })).toBe(true);
    expect(isUserFacingSession({ id: crewVoiceSessionId(textId), contextKind: 'crew_private' })).toBe(false);
  });
});
