import type { SessionContextKind } from '../types/session-context.js';

export type ChannelBindingId = 'telegram' | 'slack' | 'discord' | 'email' | 'voice';

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
    case 'voice': return 'Voice Agent';
    default: return channel;
  }
}
