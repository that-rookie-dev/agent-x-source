/**
 * Markdown → ChannelContentBlock[] parser.
 *
 * Parses common markdown syntax into structured blocks so the per-channel
 * renderers can convert them to native platform format. This is the fallback
 * path when the agent returns plain markdown instead of using the
 * `render_channel_response` tool.
 *
 * Supported syntax:
 * - # / ## / ### headers → header block
 * - ```lang\ncode``` → code block
 * - - item / * item → unordered list
 * - 1. item → ordered list
 * - > quote → quote block
 * - --- → divider block
 * - | col | col | → table block
 * - Lines starting with status emoji (✅⚠️❌📦🔧⏳🚀) → status block
 * - [text](url) in standalone link lines → link block
 * - Plain text → text block (consecutive lines merged into one block)
 */
import type { ChannelContentBlock, StatusBlock } from '@agentx/shared';

const STATUS_ICONS = new Set(['✅', '⚠️', '❌', '📦', '🔧', '⏳', '🚀']);

const HEADER_RE = /^(#{1,3})\s+(.+)$/;
const CODE_FENCE_RE = /^```(\w*)$/;
const UNORDERED_LIST_RE = /^[-*]\s+(.+)$/;
const ORDERED_LIST_RE = /^\d+\.\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const DIVIDER_RE = /^---+$/;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|[\s:|-]+\|$/;
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;

/**
 * Parse markdown text into structured content blocks.
 * Returns an array of blocks suitable for any channel renderer.
 */
export function markdownToBlocks(markdown: string): ChannelContentBlock[] {
  const lines = markdown.split('\n');
  const blocks: ChannelContentBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip blank lines (they separate blocks)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code fence
    const codeMatch = line.match(CODE_FENCE_RE);
    if (codeMatch) {
      const language = codeMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.match(CODE_FENCE_RE)) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // Header
    const headerMatch = line.match(HEADER_RE);
    if (headerMatch) {
      const level = headerMatch[1]!.length as 1 | 2 | 3;
      blocks.push({ type: 'header', level, text: headerMatch[2]!.trim() });
      i++;
      continue;
    }

    // Divider
    if (DIVIDER_RE.test(line.trim())) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // Table (needs at least header row + separator row)
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!)) {
      const headers = line.match(TABLE_ROW_RE)![1]!.split('|').map((s) => s.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i]!)) {
        rows.push(lines[i]!.match(TABLE_ROW_RE)![1]!.split('|').map((s) => s.trim()));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Quote (consecutive quote lines merged)
    const quoteMatch = line.match(QUOTE_RE);
    if (quoteMatch) {
      const quoteLines: string[] = [quoteMatch[1]!];
      i++;
      while (i < lines.length && QUOTE_RE.test(lines[i]!)) {
        quoteLines.push(lines[i]!.match(QUOTE_RE)![1]!);
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    // Unordered list (consecutive items merged)
    const unorderedMatch = line.match(UNORDERED_LIST_RE);
    if (unorderedMatch) {
      const items: string[] = [unorderedMatch[1]!.trim()];
      i++;
      while (i < lines.length && UNORDERED_LIST_RE.test(lines[i]!)) {
        items.push(lines[i]!.match(UNORDERED_LIST_RE)![1]!.trim());
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list (consecutive items merged)
    const orderedMatch = line.match(ORDERED_LIST_RE);
    if (orderedMatch) {
      const items: string[] = [orderedMatch[1]!.trim()];
      i++;
      while (i < lines.length && ORDERED_LIST_RE.test(lines[i]!)) {
        items.push(lines[i]!.match(ORDERED_LIST_RE)![1]!.trim());
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Status line (starts with a status emoji)
    const trimmed = line.trim();
    const firstChar = trimmed[0] ?? '';
    if (STATUS_ICONS.has(firstChar)) {
      const icon = firstChar as StatusBlock['icon'];
      const text = trimmed.slice(firstChar.length).trim();
      blocks.push({ type: 'status', icon, text });
      i++;
      continue;
    }

    // Standalone link
    const linkMatch = trimmed.match(LINK_RE);
    if (linkMatch) {
      blocks.push({ type: 'link', text: linkMatch[1]!, url: linkMatch[2]! });
      i++;
      continue;
    }

    // Plain text (consecutive non-empty, non-special lines merged)
    const textLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.match(HEADER_RE) &&
      !lines[i]!.match(CODE_FENCE_RE) &&
      !lines[i]!.match(UNORDERED_LIST_RE) &&
      !lines[i]!.match(ORDERED_LIST_RE) &&
      !lines[i]!.match(QUOTE_RE) &&
      !DIVIDER_RE.test(lines[i]!.trim()) &&
      !TABLE_ROW_RE.test(lines[i]!) &&
      !(STATUS_ICONS.has((lines[i]!.trim()[0] ?? '')))
    ) {
      textLines.push(lines[i]!);
      i++;
    }
    blocks.push({ type: 'text', text: textLines.join('\n') });
  }

  return blocks;
}
