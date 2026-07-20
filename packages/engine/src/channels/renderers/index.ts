/**
 * Channel renderer registry — factory for getting the right renderer per channel.
 */
import type { ChannelBindingId, ChannelRenderer } from '@agentx/shared';
import { TelegramRenderer } from './TelegramRenderer.js';
import { SlackRenderer } from './SlackRenderer.js';
import { DiscordRenderer } from './DiscordRenderer.js';
import { EmailRenderer } from './EmailRenderer.js';

export { markdownToBlocks } from './markdown-parser.js';
export { TelegramRenderer } from './TelegramRenderer.js';
export { SlackRenderer } from './SlackRenderer.js';
export { DiscordRenderer } from './DiscordRenderer.js';
export { EmailRenderer } from './EmailRenderer.js';

const RENDERERS: Partial<Record<ChannelBindingId, ChannelRenderer>> = {};

/** Get or create a renderer for the given channel. */
export function getRenderer(channel: ChannelBindingId): ChannelRenderer {
  let renderer = RENDERERS[channel];
  if (!renderer) {
    switch (channel) {
      case 'telegram':
        renderer = new TelegramRenderer();
        break;
      case 'slack':
        renderer = new SlackRenderer();
        break;
      case 'discord':
        renderer = new DiscordRenderer();
        break;
      case 'email':
        renderer = new EmailRenderer();
        break;
      default:
        // Fallback to Telegram (most permissive markdown)
        renderer = new TelegramRenderer();
        break;
    }
    RENDERERS[channel] = renderer;
  }
  return renderer;
}
