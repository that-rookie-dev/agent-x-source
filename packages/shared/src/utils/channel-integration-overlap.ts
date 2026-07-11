/** MCP integration ids superseded by Settings → Channels (inbound/outbound messaging). */
export const CHANNEL_COVERED_MCP_INTEGRATION_IDS = [
  'telegram',
  'slack',
  'discord',
] as const;

export type ChannelCoveredMcpIntegrationId = (typeof CHANNEL_COVERED_MCP_INTEGRATION_IDS)[number];

export function isChannelCoveredMcpIntegration(providerId: string): boolean {
  return (CHANNEL_COVERED_MCP_INTEGRATION_IDS as readonly string[]).includes(providerId);
}

const CHANNEL_HANDOFF_RE = /\b(continue|pick\s*up|resume|switch|move|transfer|talk|chat)\b.*\b(telegram|tg|slack|discord|email|channel)\b/i;
const CHANNEL_HANDOFF_REVERSE = /\b(telegram|tg|slack|discord|email)\b.*\b(continue|pick\s*up|resume|switch|move|transfer|talk|chat)\b/i;
const ON_CHANNEL_RE = /\b(on|via|through|in)\s+(telegram|tg|slack|discord)\b/i;

export function detectChannelHandoffIntent(text: string): { channel: 'telegram' | 'slack' | 'discord' | 'email' } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!CHANNEL_HANDOFF_RE.test(trimmed) && !CHANNEL_HANDOFF_REVERSE.test(trimmed) && !ON_CHANNEL_RE.test(trimmed)) {
    return null;
  }
  if (/\b(slack)\b/i.test(trimmed)) return { channel: 'slack' };
  if (/\b(discord)\b/i.test(trimmed)) return { channel: 'discord' };
  if (/\b(email)\b/i.test(trimmed)) return { channel: 'email' };
  return { channel: 'telegram' };
}

const CONTINUE_RE = /^\s*(continue|conitnue|go\s*on|carry\s*on|proceed|keep\s*going)\s*[.!?]?\s*$/i;

export function isBareContinueIntent(text: string): boolean {
  return CONTINUE_RE.test(text.trim());
}
