/** Client-side text helpers (mirrors @agentx/shared). */

import { normalizeMessageForUi } from '@agentx/shared/browser';

export function sanitizeForJson(text: string): string {
  if (!text) return text;
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

const TOOL_NOISE = [
  /\n?🔧 Calling: [^\n]+/g,
  /\n?✅ Result: [^\n]+/g,
  /\n?━{10,}[^\n]*/g,
  /\n?\[STEP \d+\][^\n]*/g,
  /\n?\[STEP \d+ COMPLETE\][^\n]*/g,
];

export function stripToolNoise(content: string, options?: { trim?: boolean }): string {
  if (!content) return '';
  let out = content;
  for (const re of TOOL_NOISE) out = out.replace(re, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return options?.trim === false ? out : out.trim();
}

/**
 * Repair common stream concatenation glitches for display/restore.
 * Keep in sync with @agentx/shared/utils/stream-text.ts
 */
export function repairStreamTextGlitches(text: string): string {
  if (!text || text.length < 4) return text;

  let out = text;
  out = out.replace(/^([A-Za-z]{1,30})\1(?=\s|[a-z])/g, '$1');

  const minClause = 24;
  const maxScan = Math.floor(out.length / 2);
  for (let len = maxScan; len >= minClause; len--) {
    const tail = out.slice(-len);
    const firstIdx = out.indexOf(tail);
    if (firstIdx > 0 && firstIdx + len <= out.length - len) {
      let trimAt = out.length - len;
      while (trimAt > 0 && /[\s:;,]/.test(out[trimAt - 1]!)) trimAt--;
      out = out.slice(0, trimAt);
      break;
    }
  }

  return out;
}

function partsTextLead(message: { parts?: Array<{ type: string; content?: string }> }): string {
  const raw = message.parts
    ?.filter((p) => p.type === 'text' && p.content)
    .map((p) => p.content!)
    .join('') ?? '';
  return stripToolNoise(raw, { trim: false }).slice(0, 80);
}

/** When parts[] exist, only show text from parts — not the combined content field. */
export function displayContent(message: { content?: string; parts?: Array<{ type: string; content?: string }> }): string {
  const contentText = repairStreamTextGlitches(stripToolNoise(message.content || ''));
  if (!message.parts?.length) return contentText;

  const raw = message.parts
    .filter((p) => p.type === 'text' && p.content)
    .map((p) => p.content!)
    .join('');
  const partsText = repairStreamTextGlitches(stripToolNoise(raw));

  if (!contentText) return partsText;

  const contentLead = stripToolNoise(contentText).slice(0, 80);
  const partsLead = partsTextLead(message);
  if (contentLead.length >= 20 && partsLead.length >= 20 && contentLead !== partsLead) {
    // Stored parts[] accumulated prior-turn content; content is canonical for this message
    if (partsText.length > contentText.length * 1.15 && partsText.includes(contentLead.slice(0, 40))) {
      return contentText;
    }
    if (!partsText.includes(contentLead.slice(0, 40)) && !contentText.includes(partsLead.slice(0, 40))) {
      return contentText;
    }
  }

  return partsText || contentText;
}

/** Backfill crew attribution on assistant rows in crew-private sessions. */
export function backfillCrewPrivateAssistantCrew<T extends { role?: string; crew?: { crewId: string; name: string; callsign: string } }>(
  messages: T[],
  host: { name: string; callsign: string; title?: string },
  hostCrewId?: string,
): T[] {
  if (!host.callsign) return messages;
  const crew = {
    crewId: hostCrewId ?? host.callsign,
    name: host.name,
    callsign: host.callsign,
  };
  return messages.map((m) =>
    m.role === 'assistant' && !m.crew ? { ...m, crew } : m,
  );
}

/** Normalize one restored history row (assistant parts/toolCalls reconciliation). */
export function mapRestoreHistoryMessage(m: Record<string, unknown>): Record<string, unknown> {
  const toolCalls = Array.isArray(m.toolCalls)
    ? (m.toolCalls as Array<Record<string, unknown>>).map((tc) => ({ ...tc, status: 'done' as const }))
    : undefined;
  const normalized = m.role === 'assistant'
    ? normalizeMessageForUi({ ...m, toolCalls: toolCalls ?? m.toolCalls }, [])
    : null;
  const content = normalized?.content
    ?? repairStreamTextGlitches(stripToolNoise(String(m.content || '')));
  const parts = normalized?.parts
    ?? (Array.isArray(m.parts)
      ? (m.parts as Array<Record<string, unknown>>).map((p) => (
        p.type === 'text' && p.content
          ? { ...p, content: repairStreamTextGlitches(stripToolNoise(String(p.content), { trim: false })) }
          : p
      ))
      : undefined);
  return {
    ...m,
    content,
    parts,
    toolCalls: normalized?.toolCalls ?? toolCalls,
  };
}
