import { userDeferredToAgent, isContinuationMessage } from './crew-auto-compose.js';

export interface ConversationMessage {
  role: string;
  content: string;
}

export interface TurnContextOptions {
  messages: ConversationMessage[];
  currentUserMessage: string;
  scopePath?: string | null;
  structuredSummary?: string;
  /** Max chars for the injected context block (token-efficient default ~2k). */
  maxBlockChars?: number;
}

export interface TurnContextResult {
  block: string;
  mergedTask: string;
  sessionIntent: string;
  needsContextMerge: boolean;
}

const TASK_HINT = /\b(plan|help|create|build|fix|trip|vacation|travel|itinerary|implement|design|write|analyze|prepare)\b/i;

function stripTurnBoundary(text: string): string {
  return text.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim();
}

function isSubstantiveUserMessage(text: string): boolean {
  const trimmed = stripTurnBoundary(text);
  return trimmed.length > 25 || TASK_HINT.test(trimmed);
}

const DEFERRAL_OR_SHORT = /\b(plan it yourself|you decide|figure it out|surprise me|choose for me|pick for me|on your own|your call|up to you|not sure|do it yourself|plan on your own|go ahead|yes please|sounds good|that works)\b/i;

/** First user message that establishes session intent. */
export function extractSessionIntent(messages: ConversationMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const text = stripTurnBoundary(m.content);
    if (isSubstantiveUserMessage(text)) return text.slice(0, 600);
  }
  return '';
}

/** True when the latest user message relies on prior turns for meaning. */
export function needsContextMerge(currentMessage: string, priorUserMessages: string[]): boolean {
  const current = stripTurnBoundary(currentMessage);
  if (priorUserMessages.length === 0) return false;
  if (userDeferredToAgent(current) || isContinuationMessage(current)) return true;
  if (DEFERRAL_OR_SHORT.test(current) && current.split(/\s+/).length <= 14) return true;
  if (current.split(/\s+/).length <= 8 && !TASK_HINT.test(current)) return true;
  return false;
}

function abbreviate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function recentExchange(messages: ConversationMessage[], maxTurns = 4): string {
  const relevant = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-maxTurns * 2);
  return relevant
    .map((m) => {
      const label = m.role === 'user' ? 'User' : 'Assistant';
      return `${label}: ${abbreviate(stripTurnBoundary(m.content), 280)}`;
    })
    .join('\n');
}

/**
 * Build a compact, realtime context block for the current turn.
 * Keeps token use low while preserving session intent on short follow-ups.
 */
export function buildTurnContext(opts: TurnContextOptions): TurnContextResult {
  const current = stripTurnBoundary(opts.currentUserMessage);
  const priorUsers = opts.messages
    .filter((m) => m.role === 'user')
    .map((m) => stripTurnBoundary(m.content))
    .slice(0, -1);

  const sessionIntent = extractSessionIntent(opts.messages);
  const merge = needsContextMerge(current, priorUsers);

  const mergedTask = merge && sessionIntent
    ? `${sessionIntent} ${current}`.trim()
    : current;

  const lines: string[] = [];

  if (sessionIntent) {
    lines.push(`Session intent: ${abbreviate(sessionIntent, 400)}`);
  }

  lines.push(`Current request: ${abbreviate(current, 300)}`);

  if (merge && sessionIntent && sessionIntent !== current) {
    lines.push('Note: The current message is a follow-up or deferral — execute against the session intent above using reasonable assumptions. Do not re-ask for details already provided unless critical.');
  }

  if (opts.structuredSummary?.trim()) {
    lines.push('', 'Session summary:', abbreviate(opts.structuredSummary.trim(), 800));
  }

  const exchange = recentExchange(opts.messages);
  if (exchange) {
    lines.push('', 'Recent exchange:', exchange);
  }

  if (opts.scopePath) {
    lines.push('', `Working directory: ${opts.scopePath}`);
  }

  const maxChars = opts.maxBlockChars ?? 2200;
  let block = `[TURN CONTEXT]\n${lines.join('\n')}\n[/TURN CONTEXT]`;
  if (block.length > maxChars) {
    block = `[TURN CONTEXT]\n${block.slice(0, maxChars - 20)}…\n[/TURN CONTEXT]`;
  }

  return {
    block,
    mergedTask,
    sessionIntent,
    needsContextMerge: merge,
  };
}
