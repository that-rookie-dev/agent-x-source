/**
 * Discord renderer — converts ChannelContentBlock[] into Discord.js message payloads.
 *
 * Discord supports: **bold**, *italic*, __underline__, ~~strike~~, `code`, ```lang\ncode```,
 * > blockquotes, # headers (in forums), - / 1. lists.
 * Character limit: 2000 per message.
 * Components: ActionRow with Buttons (max 5 per row, 5 rows).
 * Embeds: Rich embeds with fields, color, timestamp.
 */
import type {
  ChannelContentBlock,
  ChannelRenderResult,
  ChannelRenderer,
  ChoicesBlock,
  EmbedBlock,
} from '@agentx/shared';
import type { ChannelBindingId } from '@agentx/shared';
import { markdownToBlocks } from './markdown-parser.js';

const MAX_LENGTH = 2000;

/** Discord embed field. */
interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Discord embed. */
interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
}

/** Discord button component (simplified). */
interface DiscordButton {
  type: 2; // Button
  style: 1 | 2 | 3 | 4; // Primary, Secondary, Success, Danger
  label: string;
  custom_id: string;
}

/** Discord action row. */
interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

/** Discord message payload. */
interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
}

/** Render a single block to Discord content string. */
function renderBlockContent(block: ChannelContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;

    case 'code':
      return block.language
        ? '```' + block.language + '\n' + block.code + '\n```'
        : '```\n' + block.code + '\n```';

    case 'header': {
      const prefix = block.level === 1 ? '**' : block.level === 2 ? '**' : '**';
      const suffix = '**';
      return `${prefix}${block.text}${suffix}`;
    }

    case 'list': {
      if (block.ordered) {
        return block.items.map((item, i) => `${i + 1}. ${item}`).join('\n');
      }
      return block.items.map((item) => `- ${item}`).join('\n');
    }

    case 'quote':
      return block.text.split('\n').map((line) => '> ' + line).join('\n');

    case 'divider':
      return '────────────────';

    case 'status':
      return `${block.icon} ${block.text}`;

    case 'table': {
      // Discord doesn't render markdown tables — use code block with alignment
      const colWidths = block.headers.map((h, i) => {
        const maxData = Math.max(...block.rows.map((r) => (r[i] ?? '').length));
        return Math.max(h.length, maxData);
      });
      const formatRow = (cells: string[]) =>
        '| ' + cells.map((c, i) => (c ?? '').padEnd(colWidths[i]!)).join(' | ') + ' |';
      const sep = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
      const lines = [formatRow(block.headers), sep, ...block.rows.map(formatRow)];
      return '```\n' + lines.join('\n') + '\n```';
    }

    case 'link':
      return `[${block.text}](${block.url})`;

    case 'choices':
      // Rendered as components, not content
      return block.prompt;

    case 'embed':
      // Embeds are rendered as Discord embed objects, not content text
      // Return the title as content fallback (embed is added separately)
      return '';

    default:
      return '';
  }
}

/** Map our style to Discord button style. */
function discordButtonStyle(style?: string, recommended?: boolean): 1 | 2 | 3 | 4 {
  if (style === 'primary') return 1;
  if (style === 'danger') return 4;
  if (style === 'success' || recommended) return 3;
  return 2; // secondary
}

/** Build Discord embeds from embed blocks. */
function buildEmbeds(blocks: ChannelContentBlock[]): DiscordEmbed[] {
  const embedBlocks = blocks.filter((b): b is EmbedBlock => b.type === 'embed');
  const embeds: DiscordEmbed[] = [];

  for (const block of embedBlocks) {
    const embed: DiscordEmbed = {
      title: block.title,
    };
    if (block.description) embed.description = block.description;
    if (block.color !== undefined) embed.color = block.color;
    if (block.url) embed.title = block.title; // URL attached to title
    if (block.timestamp) embed.timestamp = block.timestamp;
    if (block.fields && block.fields.length > 0) {
      embed.fields = block.fields.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      }));
    }
    embeds.push(embed);
  }

  return embeds;
}

/** Build Discord components (action rows with buttons or select menus) from choices. */
function buildComponents(blocks: ChannelContentBlock[]): {
  components: DiscordActionRow[];
  callbackData: Array<{ id: string; label: string; value: string }>;
} {
  const choicesBlocks = blocks.filter((b): b is ChoicesBlock => b.type === 'choices');
  const components: DiscordActionRow[] = [];
  const callbackData: Array<{ id: string; label: string; value: string }> = [];

  for (const choices of choicesBlocks) {
    if (choices.options.length > 25) {
      // Use select menu for many options (Discord supports up to 25 per menu)
      // For >25, we'd need multiple menus — cap at 25 for now
      const options = choices.options.slice(0, 25).map((opt, i) => ({
        label: opt.label,
        value: `clar:pick:${i}`,
        description: opt.recommended ? 'Recommended' : undefined,
      }));
      const selectComponent = {
        type: 3, // String select menu
        custom_id: 'clar_select',
        placeholder: choices.placeholder ?? 'Select an option...',
        options,
      };
      components.push({
        type: 1,
        components: [selectComponent as unknown as DiscordButton],
      });
      for (let i = 0; i < choices.options.length && i < 25; i++) {
        const opt = choices.options[i]!;
        callbackData.push({ id: `clar:pick:${i}`, label: opt.label, value: opt.value });
      }
      continue;
    }

    const buttons: DiscordButton[] = [];
    for (let i = 0; i < choices.options.length && i < 25; i++) {
      const opt = choices.options[i]!;
      const customId = `clar:pick:${i}`;
      buttons.push({
        type: 2,
        style: discordButtonStyle(opt.style, opt.recommended),
        label: opt.label,
        custom_id: customId,
      });
      callbackData.push({ id: customId, label: opt.label, value: opt.value });
    }
    // Split into rows of 5
    for (let i = 0; i < buttons.length; i += 5) {
      components.push({
        type: 1,
        components: buttons.slice(i, i + 5),
      });
    }
  }

  return { components, callbackData };
}

export class DiscordRenderer implements ChannelRenderer {
  readonly channel: ChannelBindingId = 'discord';
  readonly maxMessageLength = MAX_LENGTH;

  renderBlocks(blocks: ChannelContentBlock[]): ChannelRenderResult[] {
    const { components, callbackData } = buildComponents(blocks);
    const embeds = buildEmbeds(blocks);
    const contentParts: string[] = [];

    for (const block of blocks) {
      const rendered = renderBlockContent(block);
      if (rendered === '') continue;
      contentParts.push(rendered);
    }

    const fullContent = contentParts.join('\n');
    const results: ChannelRenderResult[] = [];

    if (fullContent.length <= MAX_LENGTH) {
      const payload: DiscordPayload = {};
      if (fullContent.length > 0) payload.content = fullContent;
      if (embeds.length > 0) payload.embeds = embeds;
      if (components.length > 0) payload.components = components;
      results.push({
        payload,
        needsChunking: false,
        callbackData: callbackData.length > 0 ? callbackData : undefined,
      });
    } else {
      // Split at newline boundaries
      let remaining = fullContent;
      let chunkIdx = 0;
      while (remaining.length > 0) {
        let chunk = remaining.slice(0, MAX_LENGTH);
        if (remaining.length > MAX_LENGTH) {
          const lastNewline = chunk.lastIndexOf('\n');
          if (lastNewline > MAX_LENGTH * 0.5) {
            chunk = chunk.slice(0, lastNewline);
          }
        }
        remaining = remaining.slice(chunk.length).replace(/^\n/, '');
        chunkIdx++;
        const isLast = remaining.length === 0;
        const payload: DiscordPayload = { content: chunk };
        if (isLast && embeds.length > 0) payload.embeds = embeds;
        if (isLast && components.length > 0) {
          payload.components = components;
        }
        results.push({
          payload,
          needsChunking: !isLast,
          callbackData: isLast && callbackData.length > 0 ? callbackData : undefined,
        });
      }
    }

    return results;
  }

  renderMarkdown(text: string): ChannelRenderResult[] {
    return this.renderBlocks(markdownToBlocks(text));
  }
}
