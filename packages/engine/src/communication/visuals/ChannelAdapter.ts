import type { VisualUpdate, ToolCardProps } from '@agentx/shared';

export interface ChannelRenderContext {
  maxTextLength: number;
  supportsMarkdown: boolean;
  supportsButtons: boolean;
  supportsEmbeds: boolean;
}

export interface ChannelAdapter {
  getContext(): ChannelRenderContext;
  formatText(text: string): string;
  formatToolCard(card: ToolCardProps): string;
  formatThinking(content: string): string;
  formatError(message: string): string;
  renderUpdate(update: VisualUpdate): string | null;
}

export function createChannelAdapter(channel: string): ChannelAdapter {
  const contexts: Record<string, ChannelRenderContext> = {
    web: { maxTextLength: Infinity, supportsMarkdown: true, supportsButtons: true, supportsEmbeds: true },
    api: { maxTextLength: Infinity, supportsMarkdown: true, supportsButtons: false, supportsEmbeds: false },
    discord: { maxTextLength: 2000, supportsMarkdown: true, supportsButtons: true, supportsEmbeds: true },
    telegram: { maxTextLength: 4000, supportsMarkdown: true, supportsButtons: true, supportsEmbeds: false },
  };

  const context = contexts[channel] ?? contexts['api']!;

  return {
    getContext: () => context,

    formatText: (text: string) => {
      if (text.length > context.maxTextLength) {
        return text.slice(0, context.maxTextLength - 100) + '\n\n[Message truncated]';
      }
      return text;
    },

    formatToolCard: (card: ToolCardProps) => {
      const statusIcons: Record<string, string> = {
        pending: '~', running: '⟳', completed: '✓', error: '✗', denied: '—',
      };
      const icon = statusIcons[card.status] ?? '~';
      const lines = [`${icon} ${card.icon} **${card.label}**`];
      if (card.detail) lines.push(`  ${card.detail}`);
      if (card.durationMs) lines.push(`  _${card.durationMs}ms_`);
      if (card.error) lines.push(`  ❌ ${card.error}`);
      return lines.join('\n');
    },

    formatThinking: (content: string) => `_Thinking..._\n${content.slice(0, 500)}`,

    formatError: (message: string) => `**Error:** ${message}`,

    renderUpdate: (update: VisualUpdate): string | null => {
      switch (update.type) {
        case 'text_update':
          return channel === 'discord' || channel === 'telegram' ? update.unstableText : null;
        case 'tool_card':
          return channel === 'discord' || channel === 'telegram'
            ? `**${update.card.icon} ${update.card.label}**\n${update.card.detail || ''}\n_${update.card.status}_`
            : null;
        case 'tool_card_update':
          return null;
        case 'thinking_update':
          return channel === 'discord' || channel === 'telegram'
            ? `_${(update.state.content ?? '').slice(0, 200)}_`
            : null;
        case 'compaction_toast':
          return update.action === 'start' ? '_Compacting context..._' : '_Context compacted_';
        case 'toast':
          return `**${update.icon}** ${update.message}`;
        case 'spinner':
        case 'todo_update':
        case 'diff_preview':
          return null;
      }
    },
  };
}
