import { assignPartsToAssistantMessage, normalizeMessageForUi } from '@agentx/shared';
import type { CrewManager } from '@agentx/engine';

type MessageEnrichEngine = {
  crewManager: CrewManager;
};

/** Latest contiguous tail of user/assistant messages (safe for scroll-up pagination). */
export function selectRecentMessagesTail(
  messages: Array<Record<string, unknown>>,
  maxMessages: number,
): { messages: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  const limit = Math.min(Math.max(maxMessages, 1), 100);
  const visible = messages.filter((m) => m['role'] === 'user' || m['role'] === 'assistant');
  const selected = visible.slice(-limit);
  return {
    messages: selected,
    total: visible.length,
    truncated: selected.length < visible.length,
  };
}

/** @deprecated Use selectRecentMessagesTail — per-role slices leave gaps when paginating. */
export function selectRecentMessagesPerRole(
  messages: Array<Record<string, unknown>>,
  perRole: number,
): { messages: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  return selectRecentMessagesTail(messages, perRole * 2);
}

export function enrichSessionMessagesForUi(
  eng: MessageEnrichEngine,
  messages: Array<Record<string, unknown>>,
  parts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg['role'] !== 'assistant') continue;

    const msgPartRows = assignPartsToAssistantMessage(messages, parts, i);
    const normalized = normalizeMessageForUi(msg, msgPartRows);
    if (normalized.parts?.length) {
      (msg as Record<string, unknown>)['parts'] = normalized.parts;
    }
    if (normalized.content) {
      msg['content'] = normalized.content;
    }
    if (normalized.toolCalls) {
      msg['toolCalls'] = normalized.toolCalls;
    }
  }

  for (const msg of messages) {
    if (msg['tool_calls'] != null && typeof msg['tool_calls'] === 'string') {
      try { msg['tool_calls'] = JSON.parse(msg['tool_calls'] as string); } catch { msg['tool_calls'] = undefined; }
    }
    if (msg['toolCalls'] != null && typeof msg['toolCalls'] === 'string') {
      try { msg['toolCalls'] = JSON.parse(msg['toolCalls'] as string); } catch { msg['toolCalls'] = undefined; }
    }
    if (msg['metadata'] && !msg['crew']) {
      const meta = typeof msg['metadata'] === 'string'
        ? (() => { try { return JSON.parse(msg['metadata'] as string) as Record<string, unknown>; } catch { return {}; } })()
        : msg['metadata'] as Record<string, unknown>;
      if (meta['crewId']) {
        const crewMember = eng.crewManager.get(meta['crewId'] as string);
        msg['crew'] = {
          crewId: meta['crewId'],
          name: (meta['crewName'] as string) || crewMember?.name || '',
          callsign: (meta['callsign'] as string) || crewMember?.callsign || '',
          color: crewMember?.color,
          icon: crewMember?.icon,
        };
      }
    }
  }

  return messages;
}

/** Apply normalizeMessageForUi fields without dropping id, role, crew, or metadata. */
export function mergeNormalizedMessageForApi(msg: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeMessageForUi(msg, []);
  return {
    ...msg,
    content: normalized.content,
    parts: normalized.parts,
    toolCalls: normalized.toolCalls ?? msg['toolCalls'],
  };
}
