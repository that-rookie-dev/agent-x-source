/** Dedicated session id for inbound/outbound messaging channels (Telegram, etc.). */
export const CHANNEL_SESSION_ID = '__channel__';

export function isChannelSessionId(sessionId: string | null | undefined): boolean {
  return sessionId === CHANNEL_SESSION_ID;
}

/** Messaging channels operate as fleet-wide operator consoles (super sessions). */
export function isSuperSessionId(sessionId: string | null | undefined): boolean {
  return isChannelSessionId(sessionId);
}

/** When a super session calls fleet tools, omit session filter so all resources are visible. */
export function resolveFleetToolSessionScope(sessionId: string): string | undefined {
  return isSuperSessionId(sessionId) ? undefined : sessionId;
}
