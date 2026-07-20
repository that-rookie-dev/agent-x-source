import type { ChannelBindingId } from './channel-session-binding.js';
import { textSessionIdFromVoiceSessionId } from './crew-voice-session.js';

/** Prefix for all messaging-channel transcript sessions. */
export const CHANNEL_SESSION_ID = '__channel__';

const CHANNEL_SESSION_PREFIX = `${CHANNEL_SESSION_ID}:`;

const CHANNEL_BINDINGS: readonly ChannelBindingId[] = ['telegram', 'slack', 'discord', 'email', 'voice'];

/** Per-surface transcript session id, e.g. __channel__:telegram */
export function channelSessionIdForBinding(channel: ChannelBindingId): string {
  return `${CHANNEL_SESSION_PREFIX}${channel}`;
}

/** Parse channel from a channel session id; legacy __channel__ maps to telegram. */
export function parseChannelBindingFromSessionId(
  sessionId: string | null | undefined,
): ChannelBindingId | null {
  if (!sessionId) return null;
  if (sessionId === CHANNEL_SESSION_ID) return 'telegram';
  if (!sessionId.startsWith(CHANNEL_SESSION_PREFIX)) return null;
  const suffix = sessionId.slice(CHANNEL_SESSION_PREFIX.length) as ChannelBindingId;
  return CHANNEL_BINDINGS.includes(suffix) ? suffix : null;
}

export function isChannelSessionId(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  if (sessionId === CHANNEL_SESSION_ID) return true;
  return sessionId.startsWith(CHANNEL_SESSION_PREFIX);
}

/** Messaging channels operate as fleet-wide operator consoles (super sessions). Voice is a segregated session, not a super session. */
export function isSuperSessionId(sessionId: string | null | undefined): boolean {
  if (!isChannelSessionId(sessionId)) return false;
  const channel = parseChannelBindingFromSessionId(sessionId);
  return channel !== 'voice';
}

/** When a super session calls fleet tools, omit session filter so all resources are visible. */
export function resolveFleetToolSessionScope(sessionId: string): string | undefined {
  return isSuperSessionId(sessionId) ? undefined : sessionId;
}

/**
 * Session filter for automation list/cancel/register.
 * - Super sessions (Telegram/Slack/…) → undefined (fleet-wide).
 * - Crew voice calls (`voice:{textId}`) → parent text session so call + chat share tasks.
 * - Everything else → the session itself.
 */
export function resolveAutomationSessionScope(sessionId: string): string | undefined {
  if (isSuperSessionId(sessionId)) return undefined;
  const textId = textSessionIdFromVoiceSessionId(sessionId);
  if (textId) return textId;
  return sessionId;
}
