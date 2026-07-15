/** Client-side text helpers (mirrors @agentx/shared). */

import { attachDeepSearchPartsFromTools, attachChartPartsFromTools, normalizeMessageForUi, normalizeVoiceAssistantContent, type MessagePart } from '@agentx/shared/browser';

/** Ensure status/step labels are always renderable strings (avoids React #31). */
export function coerceDisplayLabel(value: unknown, fallback = 'Working...'): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && 'label' in value) {
    return coerceDisplayLabel((value as { label: unknown }).label, fallback);
  }
  return fallback;
}

/** Apply tool_complete metadata only to the matching tool call (parallel same-name tools). */
export function applyToolCompleteMetadata<T extends {
  id: string;
  name: string;
  status: string;
  metadata?: Record<string, unknown>;
}>(
  tool: T,
  meta: Record<string, unknown> | undefined,
  callId: string,
  toolName: string,
): T {
  if (!meta) return tool;
  if (callId) {
    return tool.id === callId ? { ...tool, metadata: { ...tool.metadata, ...meta } } : tool;
  }
  if (tool.name !== toolName) return tool;
  return { ...tool, metadata: { ...tool.metadata, ...meta } };
}

/** Rebuild deep_search / chart parts from per-tool metadata after a streaming turn completes. */
export function reconcileStreamingMessageParts<T extends MessagePart>(
  liveParts: T[] | undefined,
  toolCalls: Array<{ id: string; name: string; metadata?: Record<string, unknown>; streamOutput?: string; result?: string }> | undefined,
  incomingParts: T[] | undefined,
): T[] | undefined {
  const base = liveParts?.length ? liveParts : incomingParts;
  if (!base?.length) return base;
  return attachChartPartsFromTools(attachDeepSearchPartsFromTools(base, toolCalls), toolCalls) as T[];
}

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
const VOICE_BLOCK_RE = /⟨voice⟩\s*([\s\S]*?)\s*⟨\/voice⟩\s*/gi;
const VOICE_BLOCK_PARTIAL_RE = /⟨voice⟩[\s\S]*$/i;

export function extractVoiceChannelBlock(content: string): string {
  if (!content) return '';
  const blocks = [...content.matchAll(VOICE_BLOCK_RE)]
    .map((match) => repairStreamTextGlitches(stripToolNoise(match[1] || '')))
    .filter(Boolean);
  return blocks.join('\n\n').trim();
}

export function stripVoiceChannelBlock(content: string): string {
  return content.replace(VOICE_BLOCK_RE, '').replace(VOICE_BLOCK_PARTIAL_RE, '').trim();
}

export function displayContent(message: { content?: string; parts?: Array<{ type: string; content?: string }> }): string {
  const contentText = stripVoiceChannelBlock(
    repairStreamTextGlitches(stripToolNoise(normalizeVoiceAssistantContent(message.content || ''))),
  );
  if (!message.parts?.length) return contentText;

  const raw = message.parts
    .filter((p) => p.type === 'text' && p.content)
    .map((p) => stripVoiceChannelBlock(p.content!))
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

/** True when any assistant message has a pending questionnaire part. */
export function hasPendingQuestionnaire(messages: Array<{ parts?: Array<{ type?: string; questionnaire?: { status?: string } }> }>): boolean {
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === 'questionnaire' && p.questionnaire?.status === 'pending') return true;
    }
  }
  return false;
}

/** True when in-chat crew roster picker is awaiting user selection. */
type CrewRosterPickerPartLike = {
  type?: string;
  id?: string;
  crewRosterPicker?: {
    id?: string;
    status?: 'pending' | 'answered' | 'skipped';
    selectedCandidateIds?: string[];
  };
};

/** Keep resolved crew roster picker state when streaming replays stale pending parts. */
export function mergeIncomingMessageParts<T extends CrewRosterPickerPartLike>(
  prevParts: T[] | undefined,
  incomingParts: T[] | undefined,
): T[] | undefined {
  if (!incomingParts?.length) return prevParts;
  if (!prevParts?.length) return incomingParts;
  return incomingParts.map((incoming) => {
    if (incoming.type !== 'crew_roster_picker' || !incoming.crewRosterPicker) return incoming;
    const prev = prevParts.find((p) => {
      if (p.type !== 'crew_roster_picker' || !p.crewRosterPicker) return false;
      if (incoming.id && p.id === incoming.id) return true;
      return Boolean(
        incoming.crewRosterPicker?.id
        && p.crewRosterPicker.id === incoming.crewRosterPicker.id,
      );
    });
    if (
      prev?.crewRosterPicker?.status
      && prev.crewRosterPicker.status !== 'pending'
      && incoming.crewRosterPicker.status === 'pending'
    ) {
      return {
        ...incoming,
        crewRosterPicker: {
          ...incoming.crewRosterPicker,
          status: prev.crewRosterPicker.status,
          selectedCandidateIds:
            prev.crewRosterPicker.selectedCandidateIds
            ?? incoming.crewRosterPicker.selectedCandidateIds,
        },
      };
    }
    return incoming;
  });
}

export function hasPendingCrewRosterPicker(messages: Array<{ parts?: Array<{ type?: string; crewRosterPicker?: { status?: string } }> }>): boolean {
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === 'crew_roster_picker' && p.crewRosterPicker?.status === 'pending') return true;
    }
  }
  return false;
}

export function hasPendingChatInteraction(messages: Parameters<typeof hasPendingQuestionnaire>[0]): boolean {
  return hasPendingQuestionnaire(messages) || hasPendingCrewRosterPicker(messages);
}

/** Remove a trailing streaming/text-only assistant bubble before a questionnaire card. */
export function stripTrailingStreamPreamble<T extends {
  role?: string;
  streaming?: boolean;
  content?: string;
  parts?: Array<{ type?: string }>;
}>(messages: T[]): T[] {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return messages;
  const hasQuestionnaire = last.parts?.some((p) => p.type === 'questionnaire');
  const hasTools = last.parts?.some((p) => p.type === 'tool');
  if (hasQuestionnaire || hasTools) return messages;
  if (last.streaming || last.content?.trim()) {
    return messages.slice(0, -1);
  }
  return messages;
}

/** True when the last assistant message is a non-streaming questionnaire card. */
export function lastMessageIsQuestionnaireCard(messages: Array<{
  role?: string;
  streaming?: boolean;
  parts?: Array<{ type?: string; questionnaire?: { status?: string } }>;
}>): boolean {
  const last = messages[messages.length - 1];
  return last?.role === 'assistant'
    && !last.streaming
    && (last.parts?.some((p) => p.type === 'questionnaire') ?? false);
}

/** Parse legacy [MODE_CHANGE] system rows into chip metadata. */
export function parseModeChange(content?: string): { from: string; to: string } | null {
  if (!content) return null;
  const match = content.match(/^\[MODE_CHANGE\]\s*(\w+)\s*→\s*(\w+)/);
  if (!match) return null;
  return { from: match[1]!, to: match[2]! };
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
      ? (m.parts as Array<Record<string, unknown>>).map((p) => {
        if (p.type === 'text' && p.content) {
          return { ...p, content: repairStreamTextGlitches(stripToolNoise(String(p.content), { trim: false })) };
        }
        return p;
      })
      : undefined);
  return {
    ...m,
    content,
    parts,
    toolCalls: normalized?.toolCalls ?? toolCalls,
  };
}
