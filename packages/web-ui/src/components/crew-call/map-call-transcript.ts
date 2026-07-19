import { sanitizeVoiceDisplayText } from '../../voice/sanitize-display-text';
import type { CrewCallTranscriptLine } from './types';

const CALL_EVENT_RE = /^\[call_event:(open|resume)\]$/i;

/** Map persisted chat messages into call-transcript lines (skips kickoff markers). */
export function mapCallHistoryMessages(
  messages: Array<{ id?: string; role?: string; content?: string; timestamp?: string; createdAt?: string }>,
  opts?: { maxLen?: number },
): CrewCallTranscriptLine[] {
  const maxLen = opts?.maxLen ?? 2_000;
  const lines: CrewCallTranscriptLine[] = [];
  for (const m of messages) {
    const text = (m.content ?? '').trim();
    if (!text || CALL_EVENT_RE.test(text)) continue;
    const role = m.role === 'user' ? 'operator' : m.role === 'assistant' ? 'crew' : null;
    if (!role) continue;
    const cleaned = sanitizeVoiceDisplayText(text);
    if (!cleaned) continue;
    lines.push({
      id: m.id ?? crypto.randomUUID(),
      role,
      text: cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned,
      at: Date.parse(m.timestamp ?? m.createdAt ?? '') || Date.now(),
    });
  }
  return lines;
}
