import { normalizeTextForSpeech } from '@agentx/engine';

export const VOICE_BLOCK_OPEN = '⟨voice⟩';
export const VOICE_BLOCK_CLOSE = '⟨/voice⟩';

/** Drop LLM token bleed before the voice opener (e.g. stray CJK characters). */
export function normalizeVoiceAssistantContent(content: string): string {
  const idx = content.indexOf(VOICE_BLOCK_OPEN);
  if (idx > 0) return content.slice(idx);
  return content;
}

const VOICE_BLOCK_RE = /⟨voice⟩([\s\S]*?)⟨\/voice⟩/i;
const VOICE_BLOCK_STRIP_RE = /⟨voice⟩[\s\S]*?⟨\/voice⟩\s*/gi;

export function buildVoiceTurnInstruction(): string {
  return buildVoiceSummaryPhaseInstruction();
}

/** Phase 1: tools + spoken summary + ask what the user wants next. */
export function buildVoiceSummaryPhaseInstruction(): string {
  return `VOICE CHANNEL — spoken summary turn.

The user is listening via text-to-speech. You may use tools (web_search, deep_web_search, http_get, etc.) for live facts first.

When ready, output ONLY a brief spoken reply inside this exact wrapper (plain sentences — no markdown, URLs, lists, or tables):

${VOICE_BLOCK_OPEN}
2–3 sentences with the key answer. Then ask what they want next — e.g. more detail on a part, save a note, another search, or say "put the full report in chat" for the written version.
${VOICE_BLOCK_CLOSE}

CRITICAL RULES:
- Your reply MUST start with ${VOICE_BLOCK_OPEN} — no characters, words, or tokens before it.
- Do NOT say the full report is already in chat — it is not until they ask.
- After ${VOICE_BLOCK_CLOSE} write NOTHING else.
- Keep the voice block under 90 words.
- Prefer web_search for live facts. Avoid shell_exec unless absolutely necessary (max ~20s).`;
}

/** Follow-up voice turn after a summary — address the request, still voice-only. */
export function buildVoiceFollowUpPhaseInstruction(): string {
  return `VOICE CHANNEL — follow-up spoken turn.

The user already heard your spoken summary on this topic. Respond to their follow-up request.

Output ONLY a brief spoken reply inside:

${VOICE_BLOCK_OPEN}
2–4 sentences addressing their request. Use tools if needed for live facts or actions (notes, files, searches).
If they did not ask for the chat report, do NOT mention putting anything in chat.
${VOICE_BLOCK_CLOSE}

CRITICAL: After ${VOICE_BLOCK_CLOSE} write NOTHING else — no markdown body unless they explicitly asked for the full report in chat.`;
}

/** User asked for the full written report in chat — produce markdown body only. */
export function buildVoiceChatReportPhaseInstruction(): string {
  return `VOICE CHANNEL — CHAT REPORT (user explicitly requested the written answer in chat).

Produce the complete detailed chat response with markdown, links, tables, and sources — same depth as a normal text-mode answer. Use prior tool results and context from this thread.

Rules:
- Do NOT include a ${VOICE_BLOCK_OPEN} block.
- Do not repeat the spoken summary verbatim; expand with full detail.
- Answer thoroughly with sources where applicable.`;
}

/** @deprecated Use buildVoiceChatReportPhaseInstruction */
export function buildVoiceChatBodyPhaseInstruction(): string {
  return buildVoiceChatReportPhaseInstruction();
}

export function isVoiceSummaryOnlyMessage(content: string): boolean {
  const { voice, chat } = extractVoiceSpeakable(content);
  if (!voice.trim()) return false;
  return chat.length < 80;
}

/** Heuristic: user wants the full markdown report posted to chat. */
export function userWantsVoiceChatReport(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  const patterns = [
    /\b(full\s+)?report\s+in\s+(the\s+)?chat\b/,
    /\bput\s+(it|that|the\s+report|the\s+answer|everything)\s+in\s+(the\s+)?chat\b/,
    /\b(show|give|write|post|send)\s+(me\s+)?(the\s+)?(full\s+)?(report|details|answer|response)\s+in\s+(the\s+)?chat\b/,
    /\btype\s+it\s+(out|in\s+the\s+chat)\b/,
    /\bwrite\s+it\s+(in\s+the\s+chat|down\s+in\s+chat)\b/,
    /\bput\s+the\s+full\s+(report|answer)\s+in\s+chat\b/,
    /\bfull\s+(report|answer)\s+in\s+chat\b/,
  ];
  return patterns.some((re) => re.test(t));
}

/** Hold back a trailing prefix of ⟨/voice⟩ so partial close tags are not spoken as "slash". */
export function holdBackVoiceCloseSuffix(text: string): { emit: string; held: number } {
  const close = VOICE_BLOCK_CLOSE;
  let held = 0;
  for (let len = Math.min(text.length, close.length - 1); len >= 1; len -= 1) {
    if (close.startsWith(text.slice(-len))) {
      held = len;
      break;
    }
  }
  return { emit: held > 0 ? text.slice(0, -held) : text, held };
}

export function extractVoiceSpeakable(content: string): { voice: string; chat: string } {
  const normalized = normalizeVoiceAssistantContent(content);
  const match = normalized.match(VOICE_BLOCK_RE);
  if (!match) {
    return { voice: '', chat: normalized.trim() };
  }
  const voice = match[1]?.trim() ?? '';
  const chat = normalized.replace(VOICE_BLOCK_STRIP_RE, '').trim();
  return { voice, chat };
}

export function stripVoiceChannelBlock(content: string): string {
  return content.replace(VOICE_BLOCK_STRIP_RE, '').trim();
}

export function buildVoiceFallback(chat: string): string {
  const normalized = normalizeTextForSpeech(chat, { maxChars: 320 });
  if (!normalized) {
    return 'I have a brief answer for you. What would you like next?';
  }
  return normalized;
}

/** Extracts speakable deltas from streamed assistant output (voice block only). */
export class VoiceBlockStreamExtractor {
  private raw = '';
  private voiceEmitted = 0;
  private voiceClosed = false;

  get closed(): boolean {
    return this.voiceClosed;
  }

  pullSpeakDelta(delta: string): string {
    if (this.voiceClosed || !delta) return '';
    this.raw += delta;
    this.raw = normalizeVoiceAssistantContent(this.raw);

    let body = this.raw;
    const openIdx = body.indexOf(VOICE_BLOCK_OPEN);
    if (openIdx === -1) {
      if (body.length > 24) this.raw = body.slice(-24);
      return '';
    }
    body = body.slice(openIdx + VOICE_BLOCK_OPEN.length);

    const closeIdx = body.indexOf(VOICE_BLOCK_CLOSE);
    if (closeIdx === -1) {
      const pending = body.slice(this.voiceEmitted);
      const { emit, held } = holdBackVoiceCloseSuffix(pending);
      this.voiceEmitted = body.length - held;
      return emit;
    }

    const inner = body.slice(0, closeIdx);
    const speakable = inner.slice(this.voiceEmitted);
    this.voiceEmitted = inner.length;
    this.voiceClosed = true;
    return speakable;
  }
}
