/** Prefixed session id for a crew private-call transcript (sibling of the text chat). */
export const CREW_VOICE_SESSION_PREFIX = 'voice:';

/** Voice session id derived from the lifelong private text session. */
export function crewVoiceSessionId(textSessionId: string): string {
  const trimmed = textSessionId.trim();
  if (!trimmed) throw new Error('text-session-id-required');
  if (isCrewVoiceSessionId(trimmed)) return trimmed;
  return `${CREW_VOICE_SESSION_PREFIX}${trimmed}`;
}

export function isCrewVoiceSessionId(id: string): boolean {
  return id.startsWith(CREW_VOICE_SESSION_PREFIX);
}

/** Text private-chat session id linked to a voice call session, or null. */
export function textSessionIdFromVoiceSessionId(sessionId: string): string | null {
  if (!isCrewVoiceSessionId(sessionId)) return null;
  const textId = sessionId.slice(CREW_VOICE_SESSION_PREFIX.length).trim();
  return textId || null;
}
