/**
 * Telegram renderer — converts ChannelContentBlock[] into Telegram MarkdownV2
 * payloads with inline keyboard support for choices.
 *
 * Telegram MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * Character limit: 4096 per message.
 */
import type {
  ChannelContentBlock,
  ChannelRenderResult,
  ChannelRenderer,
  ChoicesBlock,
} from '@agentx/shared';
import type { ChannelBindingId } from '@agentx/shared';
import { markdownToBlocks } from './markdown-parser.js';

const MAX_LENGTH = 4096;

/** Characters that must be escaped in Telegram MarkdownV2. */
const ESCAPE_CHARS = new Set(['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\']);

const MARKERS = {
  code: String.fromCharCode(0),
  bold: String.fromCharCode(1),
  italic: String.fromCharCode(2),
  underline: String.fromCharCode(3),
  strikethrough: String.fromCharCode(4),
};

/** Escape text for Telegram MarkdownV2. */
function escapeMd(text: string): string {
  let out = '';
  for (const ch of text) {
    out += ESCAPE_CHARS.has(ch) ? '\\' + ch : ch;
  }
  return out;
}

/** Escape text but preserve intentional markdown formatting. */
function escapeMdPreserveFormat(text: string): string {
  // Protect code spans first
  const codeSpans: string[] = [];
  let processed = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `${MARKERS.code}${codeSpans.length - 1}${MARKERS.code}`;
  });

  // Protect bold/italic markers
  processed = processed
    .replace(/\*\*([^*]+)\*\*/g, `${MARKERS.bold}$1${MARKERS.bold}`)
    .replace(/\*([^*]+)\*/g, `${MARKERS.italic}$1${MARKERS.italic}`)
    .replace(/_([^_]+)_/g, `${MARKERS.underline}$1${MARKERS.underline}`)
    .replace(/~~([^~]+)~~/g, `${MARKERS.strikethrough}$1${MARKERS.strikethrough}`);

  // Escape everything else
  processed = escapeMd(processed);

  // Restore formatting markers
  processed = processed
    .replaceAll(MARKERS.bold, '*')
    .replaceAll(MARKERS.italic, '*')
    .replaceAll(MARKERS.underline, '_')
    .replaceAll(MARKERS.strikethrough, '~');

  // Restore code spans (code content doesn't need escaping inside `)
  const parts = processed.split(MARKERS.code);
  for (let i = 1; i < parts.length; i += 2) {
    const idx = Number(parts[i]);
    parts[i] = '`' + codeSpans[idx]! + '`';
  }
  return parts.join('');
}

/** Render a single block to MarkdownV2 text. */
function renderBlock(block: ChannelContentBlock): string {
  switch (block.type) {
    case 'text':
      return escapeMdPreserveFormat(block.text);

    case 'code':
      if (block.language) {
        return '```' + block.language + '\n' + block.code + '\n```';
      }
      return '```\n' + block.code + '\n```';

    case 'header': {
      const prefix = block.level === 1 ? '*** ' : block.level === 2 ? '** ' : '* ';
      return prefix + escapeMd(block.text);
    }

    case 'list': {
      if (block.ordered) {
        return block.items.map((item: string, idx: number) => `${idx + 1}\\. ${escapeMdPreserveFormat(item)}`).join('\n');
      }
      return block.items.map((item: string) => `• ${escapeMdPreserveFormat(item)}`).join('\n');
    }

    case 'quote':
      return block.text.split('\n').map((line: string) => '>' + escapeMdPreserveFormat(line)).join('\n');

    case 'divider':
      return '\n━━━━━━━━━━━━\n';

    case 'status':
      return block.icon + ' ' + escapeMd(block.text);

    case 'table':
      // Telegram doesn't support tables — convert to vertical list
      return block.rows.map((row: string[], idx: number) => {
        const fields = block.headers.map((h: string, i: number) => `*${escapeMd(h)}*: ${escapeMd(row[i] ?? '')}`);
        return `${idx + 1}\\. ` + fields.join(' | ');
      }).join('\n');

    case 'link':
      return `[${escapeMd(block.text)}](${block.url})`;

    case 'choices':
      // Choices are rendered as inline keyboards, not text
      return escapeMdPreserveFormat(block.prompt);

    case 'embed': {
      // Telegram doesn't have native embeds — render as formatted text
      const lines: string[] = [];
      lines.push(`*${escapeMd(block.title)}*`);
      if (block.description) lines.push(escapeMdPreserveFormat(block.description));
      if (block.fields) {
        for (const field of block.fields) {
          if (field.inline) {
            lines.push(`*${escapeMd(field.name)}*: ${escapeMd(field.value)}`);
          } else {
            lines.push(`\n*${escapeMd(field.name)}*`);
            lines.push(escapeMd(field.value));
          }
        }
      }
      if (block.url) lines.push(`[Link](${block.url})`);
      if (block.footer) lines.push(`\n_${escapeMd(block.footer)}_`);
      return lines.join('\n');
    }

    default:
      return '';
  }
}

/** Telegram inline keyboard button — can be callback, URL, or switch_inline_query. */
type TelegramButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; switch_inline_query: string };

/** Build inline keyboard from choices blocks. */
function buildInlineKeyboards(blocks: ChannelContentBlock[]): {
  keyboards: TelegramButton[][];
  callbackData: Array<{ id: string; label: string; value: string }>;
} | null {
  const choicesBlocks = blocks.filter((b): b is ChoicesBlock => b.type === 'choices');
  if (choicesBlocks.length === 0) return null;

  const keyboards: TelegramButton[][] = [];
  const callbackData: Array<{ id: string; label: string; value: string }> = [];

  for (const choices of choicesBlocks) {
    const rows: TelegramButton[][] = [];
    for (let i = 0; i < choices.options.length; i += 2) {
      const row: TelegramButton[] = [];
      for (let j = i; j < Math.min(i + 2, choices.options.length); j++) {
        const opt = choices.options[j]!;
        const label = (opt.recommended ? '⭐ ' : '') + opt.label;

        if (opt.url) {
          // URL button — opens link in browser
          row.push({ text: label, url: opt.url });
        } else if (opt.switchInlineQuery) {
          // Switch inline query — inserts text into chat input
          row.push({ text: label, switch_inline_query: opt.switchInlineQuery });
        } else {
          // Callback button — sends callback_data when pressed
          const id = `clar:pick:${j}`;
          row.push({ text: label, callback_data: id });
          callbackData.push({ id, label: opt.label, value: opt.value });
        }
      }
      rows.push(row);
    }
    keyboards.push(...rows);
  }

  return { keyboards, callbackData };
}

export class TelegramRenderer implements ChannelRenderer {
  readonly channel: ChannelBindingId = 'telegram';
  readonly maxMessageLength = MAX_LENGTH;

  renderBlocks(blocks: ChannelContentBlock[]): ChannelRenderResult[] {
    const keyboards = buildInlineKeyboards(blocks);
    const textParts: string[] = [];

    for (const block of blocks) {
      const rendered = renderBlock(block);
      if (rendered === '') continue;
      textParts.push(rendered);
    }

    const fullText = textParts.join('\n');
    const results: ChannelRenderResult[] = [];

    if (fullText.length <= MAX_LENGTH) {
      const payload: Record<string, unknown> = {
        text: fullText,
        parse_mode: 'MarkdownV2',
      };
      if (keyboards) {
        payload['reply_markup'] = { inline_keyboard: keyboards.keyboards };
      }
      results.push({
        payload,
        needsChunking: false,
        callbackData: keyboards?.callbackData,
      });
    } else {
      // Split at newline boundaries
      let remaining = fullText;
      let chunkIdx = 0;
      const totalChunks = Math.ceil(fullText.length / MAX_LENGTH);
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
        const payload: Record<string, unknown> = {
          text: chunk,
          parse_mode: 'MarkdownV2',
        };
        // Attach keyboards only to the last chunk
        if (keyboards && chunkIdx === totalChunks) {
          payload['reply_markup'] = { inline_keyboard: keyboards.keyboards };
        }
        results.push({
          payload,
          needsChunking: remaining.length > 0,
          callbackData: chunkIdx === totalChunks ? keyboards?.callbackData : undefined,
        });
      }
    }

    return results;
  }

  renderMarkdown(text: string): ChannelRenderResult[] {
    return this.renderBlocks(markdownToBlocks(text));
  }
}
