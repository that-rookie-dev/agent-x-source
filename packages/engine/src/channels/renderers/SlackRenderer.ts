/**
 * Slack renderer — converts ChannelContentBlock[] into Slack Block Kit blocks.
 *
 * Slack Block Kit supports: section, header, divider, context, actions, image.
 * Text type: mrkdwn (*bold*, _italic_, ~strike~, `code`, ```pre```).
 * Character limit: 3000 per message, max 50 blocks per message.
 */
import type {
  ChannelContentBlock,
  ChannelRenderResult,
  ChannelRenderer,
  ChoicesBlock,
} from '@agentx/shared';
import type { ChannelBindingId } from '@agentx/shared';
import { markdownToBlocks } from './markdown-parser.js';

const MAX_LENGTH = 3000;
const MAX_BLOCKS = 50;

/** Slack Block Kit block types (simplified for our usage). */
interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  accessory?: Record<string, unknown>;
  elements?: Array<SlackButton | Record<string, unknown>>;
  fields?: Array<{ type: string; text: string }>;
}

interface SlackButton {
  type: 'button';
  text: { type: 'plain_text'; text: string };
  action_id: string;
  style?: 'primary' | 'danger';
}

/** Render a single block to Slack Block Kit block(s). */
function renderBlock(block: ChannelContentBlock): SlackBlock[] {
  switch (block.type) {
    case 'text':
      return [{ type: 'section', text: { type: 'mrkdwn', text: block.text } }];

    case 'code': {
      const codeText = block.language
        ? '```' + block.language + '\n' + block.code + '\n```'
        : '```\n' + block.code + '\n```';
      return [{ type: 'section', text: { type: 'mrkdwn', text: codeText } }];
    }

    case 'header':
      return [{ type: 'header', text: { type: 'plain_text', text: block.text } }];

    case 'list': {
      const prefix = block.ordered ? '' : '• ';
      const lines = block.ordered
        ? block.items.map((item, i) => `${i + 1}. ${item}`)
        : block.items.map((item) => `${prefix}${item}`);
      return [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }];
    }

    case 'quote':
      return [{ type: 'section', text: { type: 'mrkdwn', text: '> ' + block.text.split('\n').join('\n> ') } }];

    case 'divider':
      return [{ type: 'divider' }];

    case 'status':
      return [{ type: 'context', elements: [{ type: 'mrkdwn', text: `${block.icon} ${block.text}` }] }];

    case 'table': {
      // Slack mrkdwn supports pipe tables
      const headerRow = `| ${block.headers.join(' | ')} |`;
      const sepRow = `| ${block.headers.map(() => '---').join(' | ')} |`;
      const dataRows = block.rows.map((row: string[]) => `| ${row.join(' | ')} |`);
      const tableText = [headerRow, sepRow, ...dataRows].join('\n');
      return [{ type: 'section', text: { type: 'mrkdwn', text: tableText } }];
    }

    case 'link':
      return [{ type: 'section', text: { type: 'mrkdwn', text: `<${block.url}|${block.text}>` } }];

    case 'choices':
      // Rendered as actions block with buttons or select menu
      return []; // handled separately

    case 'embed': {
      // Slack doesn't have native embeds — render as section with fields
      const blocks: SlackBlock[] = [];
      const titleText = block.url ? `<${block.url}|*${block.title}*>` : `*${block.title}*`;
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: titleText } });
      if (block.description) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: block.description } });
      }
      if (block.fields && block.fields.length > 0) {
        // Slack supports max 10 fields per section, inline pairs
        const inlineFields = block.fields.filter((f) => f.inline);
        const blockFields = block.fields.filter((f) => !f.inline);

        if (inlineFields.length > 0) {
          blocks.push({
            type: 'section',
            fields: inlineFields.slice(0, 10).map((f) => ({
              type: 'mrkdwn',
              text: `*${f.name}*\n${f.value}`,
            })),
          });
        }
        for (const f of blockFields) {
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*${f.name}*\n${f.value}` },
          });
        }
      }
      if (block.footer) {
        blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: block.footer }] });
      }
      return blocks;
    }

    default:
      return [];
  }
}

/** Map our style to Slack button style. */
function slackButtonStyle(style?: string): 'primary' | 'danger' | undefined {
  if (style === 'primary' || style === 'success') return 'primary';
  if (style === 'danger') return 'danger';
  return undefined;
}

/** Build Slack actions blocks from choices. Supports buttons (≤25 options) and select menus (>25). */
function buildActionsBlocks(blocks: ChannelContentBlock[]): {
  actionBlocks: SlackBlock[];
  callbackData: Array<{ id: string; label: string; value: string }>;
} {
  const choicesBlocks = blocks.filter((b): b is ChoicesBlock => b.type === 'choices');
  const actionBlocks: SlackBlock[] = [];
  const callbackData: Array<{ id: string; label: string; value: string }> = [];

  for (const choices of choicesBlocks) {
    if (choices.options.length > 25) {
      // Use static select menu for many options (Slack supports up to 100)
      const options = choices.options.slice(0, 100).map((opt, i) => ({
        text: { type: 'plain_text', text: opt.label },
        value: `clar_pick_${i}`,
      }));
      const placeholder = choices.placeholder ?? 'Select an option...';
      actionBlocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: choices.prompt },
        accessory: {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: placeholder },
          options,
        },
      });
      for (let i = 0; i < choices.options.length && i < 100; i++) {
        const opt = choices.options[i]!;
        callbackData.push({ id: `clar_pick_${i}`, label: opt.label, value: opt.value });
      }
      continue;
    }

    // Buttons for ≤25 options
    const elements: SlackButton[] = [];
    for (let i = 0; i < choices.options.length && i < 25; i++) {
      const opt = choices.options[i]!;
      const actionId = `clar_pick_${i}`;
      const styleHint = opt.style ?? (opt.recommended ? 'primary' : 'secondary');
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: (opt.recommended ? '⭐ ' : '') + opt.label },
        action_id: actionId,
        style: slackButtonStyle(styleHint),
      });
      callbackData.push({ id: actionId, label: opt.label, value: opt.value });
    }
    if (elements.length > 0) {
      actionBlocks.push({ type: 'actions', elements });
    }
  }

  return { actionBlocks, callbackData };
}

export class SlackRenderer implements ChannelRenderer {
  readonly channel: ChannelBindingId = 'slack';
  readonly maxMessageLength = MAX_LENGTH;

  renderBlocks(blocks: ChannelContentBlock[]): ChannelRenderResult[] {
    const { actionBlocks, callbackData } = buildActionsBlocks(blocks);
    const allBlocks: SlackBlock[] = [];

    for (const block of blocks) {
      if (block.type === 'choices') {
        // Add the prompt as a section, then the action buttons
        allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: block.prompt } });
        continue;
      }
      allBlocks.push(...renderBlock(block));
    }

    // Add action blocks at the end
    allBlocks.push(...actionBlocks);

    // Chunk if too many blocks or too long
    const results: ChannelRenderResult[] = [];
    let currentBlocks: SlackBlock[] = [];
    let currentLen = 0;

    for (const blk of allBlocks) {
      const blkText = blk.text?.text ?? '';
      const blkLen = blkText.length + 50; // overhead estimate

      if ((currentLen + blkLen > MAX_LENGTH || currentBlocks.length >= MAX_BLOCKS) && currentBlocks.length > 0) {
        results.push({
          payload: { blocks: currentBlocks },
          needsChunking: true,
        });
        currentBlocks = [];
        currentLen = 0;
      }

      currentBlocks.push(blk);
      currentLen += blkLen;
    }

    if (currentBlocks.length > 0) {
      results.push({
        payload: { blocks: currentBlocks },
        needsChunking: false,
        callbackData: callbackData.length > 0 ? callbackData : undefined,
      });
    }

    return results;
  }

  renderMarkdown(text: string): ChannelRenderResult[] {
    return this.renderBlocks(markdownToBlocks(text));
  }
}
