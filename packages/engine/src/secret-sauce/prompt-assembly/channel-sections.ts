/**
 * Per-channel messaging prompt sections.
 *
 * Each channel (Telegram, Slack, Discord, Email) has its own formatting rules,
 * character limits, and native UI capabilities. These sections instruct the LLM
 * to produce output that renders natively on the target platform.
 *
 * The shared policy section (`createChannelPolicySection`) covers tool approval,
 * permission management, and clarification rules that are common across all channels.
 */
import type { PromptSection } from './types.js';

// ─────────────────────────────────────────────────────────────
// Shared channel policy (tool approval, permissions, clarifications)
// ─────────────────────────────────────────────────────────────

export function createChannelPolicySection(): PromptSection<null> {
  return {
    key: 'core/channel-policy',
    load: () => null,
    render: () => [
      '[CHANNEL_POLICY]',
      'You are in normal Agent execution mode. Tools are gated by the session permission rules and may require inline user approval.',
      'Every tool use requires explicit user approval via inline buttons: Allow Once, Always Allow, or Deny.',
      'Remembered permissions persist for this channel session until revoked.',
      'When the user asks to see permissions, call channel_permissions with action "list".',
      'When they ask to revoke one, several, or all permissions, call channel_permissions with action "revoke" and tools[] or revoke_all:true.',
      'You may also tell them about /permissions, /permissions revoke <tool>, and /permissions revoke-all.',
      '',
      'CLARIFICATION RULES:',
      '- Open-ended questions → plain assistant message text (NOT ask_clarification).',
      '- ask_clarification only for single_choice or multi_choice — rendered as native inline buttons.',
      '- Never use ask_clarification with type "text".',
      '[/CHANNEL_POLICY]',
    ].join('\n'),
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Telegram — MarkdownV2, inline keyboards, no tables
// ─────────────────────────────────────────────────────────────

export function createTelegramMessagingSection(): PromptSection<null> {
  return {
    key: 'core/channel-messaging-telegram',
    load: () => null,
    render: () => [
      '[TELEGRAM_MESSAGING]',
      'You are responding on Telegram. Follow these formatting rules strictly:',
      '',
      'FORMATTING:',
      '- Use Telegram MarkdownV2: *bold*, _italic_, __underline__, ~strikethrough~, `inline code`, ```pre blocks```, [link text](url).',
      '- Escape these special characters with a backslash: _ * [ ] ( ) ~ ` > # + - = | { } . !',
      '- Max 4096 characters per message. The bridge splits automatically, but prefer self-contained chunks.',
      '',
      'STYLE:',
      '- Keep replies concise: 1-3 short paragraphs max. Mobile screen real estate is limited.',
      '- Use numbered lists (1. 2. 3.) for steps — Telegram renders them cleanly.',
      '- Use short status lines with emoji for progress: ✅ done, ⚠️ warning, ❌ error, 📦 created, 🔧 working.',
      '- For code: use `inline code` for short snippets, ```pre blocks``` for multi-line.',
      '',
      'CONSTRAINTS:',
      '- NO tables — Telegram does not render them. Convert tabular data to vertical lists.',
      '- NO HTML tags — use MarkdownV2 only.',
      '- NO long explanations unless explicitly asked. Telegram is a chat app, not a document viewer.',
      '',
      'CHOICES:',
      '- For single-choice or multi-choice questions, use ask_clarification — the bridge renders options as Telegram inline keyboard buttons.',
      '- Do NOT list options as plain text if you can use ask_clarification instead.',
      '[/TELEGRAM_MESSAGING]',
    ].join('\n'),
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Slack — mrkdwn, Block Kit, tables OK, threads
// ─────────────────────────────────────────────────────────────

export function createSlackMessagingSection(): PromptSection<null> {
  return {
    key: 'core/channel-messaging-slack',
    load: () => null,
    render: () => [
      '[SLACK_MESSAGING]',
      'You are responding on Slack. Follow these formatting rules strictly:',
      '',
      'FORMATTING:',
      '- Use Slack mrkdwn: *bold*, _italic_, ~strikethrough~, `inline code`, ```code blocks```, <url|link text>.',
      '- Max 3000 characters per message block. The bridge uses Block Kit for structured content.',
      '- Use --- on its own line to indicate a visual divider between sections.',
      '',
      'STYLE:',
      '- Use *bold headers* to separate sections — makes messages scannable in Slack.',
      '- Use short status lines with emoji: ✅ done, ⚠️ warning, ❌ error, 📦 created, 🔧 working.',
      '- For code: always use ```language\\ncode``` blocks with language hints for syntax highlighting.',
      '- For structured/tabular data: use | column | column | pipe table syntax — Slack renders tables in mrkdwn.',
      '- Keep responses professional but conversational — Slack is a workplace chat tool.',
      '',
      'THREADS:',
      '- The bridge automatically replies in threads. You do not need to do anything special.',
      '- Keep thread replies focused on the original question.',
      '',
      'CHOICES:',
      '- For single-choice or multi-choice questions, use ask_clarification — the bridge renders options as Block Kit action buttons.',
      '- Do NOT list options as plain text if you can use ask_clarification instead.',
      '[/SLACK_MESSAGING]',
    ].join('\n'),
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Discord — Discord markdown, embeds for structured data, no tables
// ─────────────────────────────────────────────────────────────

export function createDiscordMessagingSection(): PromptSection<null> {
  return {
    key: 'core/channel-messaging-discord',
    load: () => null,
    render: () => [
      '[DISCORD_MESSAGING]',
      'You are responding on Discord. Follow these formatting rules strictly:',
      '',
      'FORMATTING:',
      '- Use Discord markdown: **bold**, *italic*, __underline__, ~~strikethrough~~, `inline code`, ```language\\ncode``` blocks, > blockquotes.',
      '- Max 2000 characters per message. The bridge splits automatically.',
      '',
      'STYLE:',
      '- Use **bold headers** to separate sections.',
      '- Use short status lines with emoji: ✅ done, ⚠️ warning, ❌ error, 📦 created, 🔧 working.',
      '- For code: always use ```language\\ncode``` — Discord supports syntax highlighting.',
      '- For quotes: use > prefix for blockquotes.',
      '- Keep responses conversational — Discord is a chat platform, not a document viewer.',
      '- Use - or 1. for lists — Discord renders both cleanly.',
      '',
      'CONSTRAINTS:',
      '- NO tables — Discord does not render markdown tables. Use code blocks with aligned columns or vertical lists.',
      '- For multi-field structured data, the bridge can create Discord embeds — use the render_channel_response tool with structured blocks if needed.',
      '',
      'CHOICES:',
      '- For single-choice or multi-choice questions, use ask_clarification — the bridge renders options as Discord button components.',
      '- Do NOT list options as plain text if you can use ask_clarification instead.',
      '[/DISCORD_MESSAGING]',
    ].join('\n'),
    diff: () => null,
  };
}

// ─────────────────────────────────────────────────────────────
// Email — HTML-friendly markdown, tables OK, longer responses
// ─────────────────────────────────────────────────────────────

export function createEmailMessagingSection(): PromptSection<null> {
  return {
    key: 'core/channel-messaging-email',
    load: () => null,
    render: () => [
      '[EMAIL_MESSAGING]',
      'You are responding via email. Follow these formatting rules:',
      '',
      'FORMATTING:',
      '- Use markdown: **bold**, *italic*, `code`, ```code blocks```, [link text](url), ## headers.',
      '- The bridge converts markdown to styled HTML — tables, links, and code highlighting are all supported.',
      '',
      'STYLE:',
      '- Email is not real-time chat — users expect more detail than a chat message.',
      '- Include a brief summary at the top, then details below.',
      '- Use ## headers for sections, **bold** for emphasis.',
      '- For structured data: use standard markdown tables — they render as styled HTML tables.',
      '- For code: use ```language\\ncode``` blocks — rendered with syntax highlighting.',
      '- For links: use [text](url) — rendered as clickable HTML links.',
      '',
      'CHOICES:',
      '- For choices, present options as a numbered list. The user replies with the number.',
      '- ask_clarification is not available for email — always use plain text for questions.',
      '[/EMAIL_MESSAGING]',
    ].join('\n'),
    diff: () => null,
  };
}
