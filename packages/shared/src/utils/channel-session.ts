/** Dedicated session id for inbound/outbound messaging channels (Telegram, etc.). */
export const CHANNEL_SESSION_ID = '__channel__';

export function isChannelSessionId(sessionId: string | null | undefined): boolean {
  return sessionId === CHANNEL_SESSION_ID;
}
