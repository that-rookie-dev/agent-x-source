import type { SessionContextKind } from '../types/session-context.js';

export type ChannelBindingId = 'telegram' | 'slack' | 'discord' | 'email';

export interface ChannelSessionBinding {
  channel: ChannelBindingId;
  sessionId: string;
  contextKind?: SessionContextKind;
  sessionTitle?: string;
  boundAt: string;
}

export function formatChannelBindingLabel(channel: ChannelBindingId): string {
  switch (channel) {
    case 'telegram': return 'Telegram';
    case 'slack': return 'Slack';
    case 'discord': return 'Discord';
    case 'email': return 'Email';
    default: return channel;
  }
}
