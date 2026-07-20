/**
 * Channel response rendering types.
 *
 * The agent produces structured `ChannelContentBlock[]` (or plain markdown that
 * gets parsed into blocks). Each channel renderer converts these blocks into
 * platform-native format (Telegram MarkdownV2, Slack Block Kit, Discord embeds,
 * HTML email).
 */
import type { ChannelBindingId } from '../utils/channel-session-binding.js';

// ─────────────────────────────────────────────────────────────
// Content blocks — structured representation of a message
// ─────────────────────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface CodeBlock {
  type: 'code';
  language?: string;
  code: string;
}

export interface HeaderBlock {
  type: 'header';
  level: 1 | 2 | 3;
  text: string;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: string[];
}

export interface QuoteBlock {
  type: 'quote';
  text: string;
}

export interface DividerBlock {
  type: 'divider';
}

export interface StatusBlock {
  type: 'status';
  icon: '✅' | '⚠️' | '❌' | '📦' | '🔧' | '⏳' | '🚀';
  text: string;
}

export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface ChoiceOption {
  label: string;
  value: string;
  recommended?: boolean;
  /** Button style hint (Slack/Discord). Telegram ignores this. */
  style?: 'primary' | 'danger' | 'success' | 'secondary';
  /** If set, button opens this URL instead of sending a callback. */
  url?: string;
  /** If set, Telegram switch_inline_query behavior — inserts text into chat input. */
  switchInlineQuery?: string;
}

export interface ChoicesBlock {
  type: 'choices';
  prompt: string;
  options: ChoiceOption[];
  multi?: boolean;
  /** Placeholder text for select menu rendering (when too many options for buttons). */
  placeholder?: string;
}

export interface LinkBlock {
  type: 'link';
  text: string;
  url: string;
}

/** A field in an embed (Discord/Slack) or callout box (Email). */
export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Structured embed block — rendered as Discord embed, Slack section with fields, or Email callout. */
export interface EmbedBlock {
  type: 'embed';
  title: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  url?: string;
  thumbnailUrl?: string;
  footer?: string;
  timestamp?: string;
}

/** A structured block the agent can emit instead of raw markdown. */
export type ChannelContentBlock =
  | TextBlock
  | CodeBlock
  | HeaderBlock
  | ListBlock
  | QuoteBlock
  | DividerBlock
  | StatusBlock
  | TableBlock
  | ChoicesBlock
  | LinkBlock
  | EmbedBlock;

// ─────────────────────────────────────────────────────────────
// Render result — what the renderer produces for the platform API
// ─────────────────────────────────────────────────────────────

/** Platform-native payload (string for Telegram, blocks[] for Slack, embed+components for Discord). */
export interface ChannelRenderResult {
  /** Platform-native payload — type varies per channel. */
  payload: unknown;
  /** Whether this message needs further chunking by the bridge. */
  needsChunking: boolean;
  /** Optional callback data for interactive elements (button callbacks). */
  callbackData?: Array<{ id: string; label: string; value: string }>;
}

// ─────────────────────────────────────────────────────────────
// Renderer interface
// ─────────────────────────────────────────────────────────────

/**
 * Converts structured content blocks into platform-native format.
 * Each channel implements this interface.
 */
export interface ChannelRenderer {
  /** Render structured blocks into platform-native format. */
  renderBlocks(blocks: ChannelContentBlock[]): ChannelRenderResult[];
  /** Render plain markdown text (fallback when agent doesn't use structured blocks). */
  renderMarkdown(text: string): ChannelRenderResult[];
  /** Platform character limit per message. */
  readonly maxMessageLength: number;
  /** Platform name. */
  readonly channel: ChannelBindingId;
}
