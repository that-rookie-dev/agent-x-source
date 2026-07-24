import { parseCallDivider, readCallDividerMeta } from '@agentx/shared/browser';
import { sanitizeVoiceDisplayText } from '../../voice/sanitize-display-text';
import type { CrewCallTranscriptLine } from './types';

const CALL_EVENT_RE = /^\[call_event:(open|resume)\]$/i;

/** Map persisted chat messages into call-transcript lines (skips kickoff markers). */
export function mapCallHistoryMessages(
  messages: Array<{
    id?: string;
    role?: string;
    content?: string;
    timestamp?: string;
    createdAt?: string;
    metadata?: unknown;
  }>,
  opts?: { maxLen?: number },
): CrewCallTranscriptLine[] {
  const maxLen = opts?.maxLen ?? 2_000;
  const lines: CrewCallTranscriptLine[] = [];
  for (const m of messages) {
    const text = (m.content ?? '').trim();
    const at = Date.parse(m.timestamp ?? m.createdAt ?? '') || Date.now();
    const id = m.id ?? crypto.randomUUID();

    // Standalone divider rows (e.g. call duration at hang-up).
    const standalone = parseCallDivider(text, m.metadata);
    if (standalone && /^\[call_divider:/i.test(text)) {
      lines.push({
        id,
        role: 'system',
        text: standalone.label,
        at,
        divider: standalone.variant,
      });
      continue;
    }

    if (!text || CALL_EVENT_RE.test(text)) continue;
    const role = m.role === 'user' ? 'operator' : m.role === 'assistant' ? 'crew' : null;
    if (!role) continue;
    if (/^\[INTERNAL CONTEXT/i.test(text) || /Call connected\. Speak first/i.test(text)) continue;
    const cleaned = sanitizeVoiceDisplayText(text);
    if (!cleaned) continue;

    // Divider attached to this spoken turn at persist time.
    const before = readCallDividerMeta(m.metadata);
    if (before) {
      lines.push({
        id: `${id}-div`,
        role: 'system',
        text: before.label,
        at,
        divider: before.variant,
      });
    }

    lines.push({
      id,
      role,
      text: cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned,
      at,
    });
  }
  return lines;
}
