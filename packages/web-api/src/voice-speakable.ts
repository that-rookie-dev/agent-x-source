import { normalizeTextForSpeech } from '@agentx/engine';

export const VOICE_BLOCK_OPEN = '⟨voice⟩';
export const VOICE_BLOCK_CLOSE = '⟨/voice⟩';

/** Drop LLM token bleed before the voice opener (e.g. stray CJK characters). */
export function normalizeVoiceAssistantContent(content: string): string {
  // Normalize ASCII <voice> variants to Unicode ⟨voice⟩ — LLMs sometimes use
  // regular angle brackets instead of the Unicode ones we instruct.
  // Also handle mixed ASCII/Unicode bracket variants like </voice⟩ or ⟨/voice>.
  const normalized = content
    .replace(/<voice>/g, VOICE_BLOCK_OPEN)
    .replace(/<\/voice>/g, VOICE_BLOCK_CLOSE)
    .replace(/<\/voice⟩/g, VOICE_BLOCK_CLOSE)
    .replace(/⟨\/voice>/g, VOICE_BLOCK_CLOSE);
  const idx = normalized.indexOf(VOICE_BLOCK_OPEN);
  if (idx > 0) return normalized.slice(idx);
  return normalized;
}

const VOICE_BLOCK_RE = /⟨voice⟩([\s\S]*?)⟨\/voice⟩/i;
const VOICE_BLOCK_STRIP_RE = /⟨voice⟩[\s\S]*?⟨\/voice⟩\s*/gi;

export function buildVoiceTurnInstruction(): string {
  return buildVoiceSummaryPhaseInstruction();
}

/** Phone-call turn for crew-private sessions — stay in character, not Agent-X voice chat. */
export function buildCrewCallTurnInstruction(): string {
  return `CREW PHONE CALL — spoken turn.

You are on a live phone call with the user as yourself (the crew persona above) — not Agent-X, not a generic assistant.

Speak naturally like a real phone conversation in your persona:
- Short turns (1–3 spoken sentences). Plain speech only.
- Stay in character — match your tone, expertise, and mannerisms.
- Prefer ending with a short question when it keeps the call moving.
- No markdown, bullet lists, URLs, skill menus, or generic AI clichés.
- Do not offer to "put a report in chat" unless they explicitly ask for written notes.
- Use tools (web_search, deep_web_search, http_get, integration__* MCP tools, etc.) when you need live facts, research, or connected apps before answering.

Output ONLY a brief spoken reply inside this exact wrapper:

${VOICE_BLOCK_OPEN}
Your spoken reply as this person on the call.
${VOICE_BLOCK_CLOSE}

CRITICAL:
- Your reply MUST start with ${VOICE_BLOCK_OPEN} — nothing before it.
- After ${VOICE_BLOCK_CLOSE} write NOTHING else.
- Keep the voice block under 60 words.
- Prefer web_search for current information when the topic needs it.
- THIS TURN OVERRIDES conflicting system-prompt rules: ignore [CHAT_MARKDOWN] and questionnaire/clarification forms — ask follow-ups as spoken sentences inside the voice block.`;
}

/** First move when a crew call connects (or reconnects after hold) — local STT→LLM→TTS. */
export function buildCrewCallOpenerInstruction(kind: 'open' | 'resume' = 'open'): string {
  const beat = kind === 'resume'
    ? 'The call was on hold and just resumed. You speak first: briefly acknowledge you are back, then ask one natural follow-up from prior context (or invite them to continue).'
    : 'The call just connected. YOU MUST SPEAK FIRST with a warm in-character welcome (as this crew person, not Agent-X), then ask ONE short question to open the conversation. Do not wait for the user. If prior history exists, you may briefly acknowledge continuity.';
  return `CREW PHONE CALL — ${kind === 'resume' ? 'resume' : 'opening'} turn.

${beat}

Stay fully in character (name, tone, expertise). Sound like a real person on a phone — not a generic AI assistant.

Output ONLY:

${VOICE_BLOCK_OPEN}
Welcome / greeting in character, then one short question. 2–3 spoken sentences max.
${VOICE_BLOCK_CLOSE}

CRITICAL:
- Start with ${VOICE_BLOCK_OPEN}. Nothing after ${VOICE_BLOCK_CLOSE}.
- You MUST include a welcome note AND a question.
- Under 55 words. No markdown. No capability lists. No tools on this turn.`;
}

/**
 * xAI / realtime opener — spoken audio is produced natively.
 * Must NOT use ⟨voice⟩ wrappers (those are for the local TTS pipeline only).
 */
export function buildCrewCallRealtimeOpenerInstruction(kind: 'open' | 'resume' = 'open'): string {
  const beat = kind === 'resume'
    ? 'The call was on hold and just resumed. Speak first now: briefly acknowledge you are back, then ask one natural follow-up (or invite them to continue).'
    : 'The call just connected. Speak first immediately with a warm in-character welcome, then ask ONE short question. Do not wait for the user. If prior history exists, you may briefly acknowledge continuity.';
  return `CREW PHONE CALL — ${kind === 'resume' ? 'resume' : 'opening'} greeting.

${beat}

You are on a live phone call as yourself — not Agent-X. Speak naturally out loud:
- 2–3 short spoken sentences max.
- Plain speech only — no markdown, tags, wrappers, tool lists, or stage directions.
- Include a welcome AND one question.
- No tools on this turn.`;
}

export function isCrewCallEventText(text: string): boolean {
  return /^\[call_event:(open|resume)\]$/i.test(text.trim());
}

/** Phase 1: tools + spoken summary + ask what the user wants next. */
export function buildVoiceSummaryPhaseInstruction(): string {
  return `VOICE CHANNEL — spoken summary turn.

The user is listening via text-to-speech. You may use tools (web_search, deep_web_search, http_get, etc.) for live facts first.

When ready, output ONLY a brief spoken reply inside this exact wrapper (plain sentences — no markdown, URLs, lists, or tables):

${VOICE_BLOCK_OPEN}
1–2 crisp sentences with the key answer. Then ask one short follow-up question or offer a single next step.
${VOICE_BLOCK_CLOSE}

CRITICAL RULES:
- Your reply MUST start with ${VOICE_BLOCK_OPEN} — no characters, words, or tokens before it.
- Do NOT say the full report is already in chat — it is not until they ask.
- After ${VOICE_BLOCK_CLOSE} write NOTHING else.
- Keep the voice block under 40 words.
- Be terse. Do not summarize, repeat, or elaborate.
- Prefer web_search for live facts. Avoid shell_exec unless absolutely necessary (max ~20s).
- THIS TURN OVERRIDES conflicting system-prompt rules: ignore [CHAT_MARKDOWN] formatting and the "deliver plans as markdown in chat" conduct. Ask conversational follow-ups as plain spoken sentences inside the voice block — do NOT call ask_clarification on this voice turn.`;
}

/** Follow-up voice turn after a summary — address the request, still voice-only. */
export function buildVoiceFollowUpPhaseInstruction(): string {
  return `VOICE CHANNEL — follow-up spoken turn.

The user already heard your spoken summary on this topic. Respond to their follow-up request.

If the user replied with a short affirmative ("yes please", "sure", "go ahead"), it accepts the offer or question in YOUR previous reply — deliver that now. If you offered several options, cover the most useful one briefly and ask which other they want.

Output ONLY a brief spoken reply inside:

${VOICE_BLOCK_OPEN}
1–2 crisp sentences addressing their request. Use tools if needed for live facts or actions (notes, files, searches).
If they did not ask for the chat report, do NOT mention putting anything in chat.
${VOICE_BLOCK_CLOSE}

CRITICAL:
- After ${VOICE_BLOCK_CLOSE} write NOTHING else — no markdown body unless they explicitly asked for the full report in chat.
- Keep the voice block under 40 words.
- Be terse. Do not summarize, repeat, or elaborate.
- THIS TURN OVERRIDES conflicting system-prompt rules: ignore [CHAT_MARKDOWN] formatting and the "deliver plans as markdown in chat" conduct. Ask conversational follow-ups as plain spoken sentences inside the voice block — do NOT call ask_clarification on this voice turn.`;
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

export function isVoiceSummaryOnlyMessage(content: string): boolean {
  const { voice, chat } = extractVoiceSpeakable(content);
  if (!voice.trim()) return false;
  return chat.length < 80;
}

/** Short affirmative that accepts the assistant's previous offer ("yes please", "sure, go ahead"). */
export function isAffirmativeReply(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/[.!,\s]+$/, '');
  if (!t || t.split(/\s+/).length > 5) return false;
  return /^(yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|please do|do it|go ahead|sounds good|that would be great)([,]?\s+(please|thanks|thank you|do that|go ahead))?$/.test(t)
    || /^yes[,]?\s+please$/.test(t);
}

/** True when the assistant's spoken block offered to put the full report/answer in chat. */
export function voiceOfferedChatReport(content: string): boolean {
  const { voice } = extractVoiceSpeakable(content);
  if (!voice) return false;
  return /\bin (the )?chat\b/i.test(voice)
    && /\b(report|answer|details?|itinerary|version|breakdown|write|put)\b/i.test(voice);
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
    return { voice: '', chat: sanitizeSpeakableText(normalized) };
  }
  const voice = sanitizeSpeakableText(match[1] ?? '');
  const chat = sanitizeSpeakableText(normalized.replace(VOICE_BLOCK_STRIP_RE, ''));
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

/**
 * Strip LLM internal token bleed and XML-like markup from speakable text.
 * This prevents TTS from reading raw tags like <tool_call>, <invoke>, <url>,
 * or model-specific token leaks like ]<]minimax[>[ that sometimes appear
 * inside or after voice blocks.
 */
// Allow digits/hyphen in model tokens (e.g. minimax, gpt-4o bleed variants).
const LLM_TOKEN_BLEED_RE = /\]?<\]?[a-zA-Z0-9_-]+\[?>?\[?/g;
const XML_LIKE_TAG_RE = /<\/?[a-zA-Z_][^>]*>/g;

export function sanitizeSpeakableText(text: string): string {
  if (!text) return '';
  let out = text;
  // 1. Remove XML-like tags (e.g. <tool_call>, <invoke name="...">, <url>, </url>)
  out = out.replace(XML_LIKE_TAG_RE, ' ');
  // 2. Remove model-specific token bleed (e.g. ]<]minimax[>[) — the whole
  //    pattern including the model name is stripped so it isn't spoken.
  out = out.replace(LLM_TOKEN_BLEED_RE, ' ');
  // 3. Remove any remaining stray bracket / angle-bracket characters that
  //    are clearly not part of natural speech.
  out = out.replace(/[<>[\]]/g, ' ');
  // 4. Collapse whitespace
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/** Sanitize assistant text for UI / WS status (voice block preferred when present). */
export function sanitizeVoiceDisplayText(text: string): string {
  if (!text) return '';
  const { voice, chat } = extractVoiceSpeakable(text);
  const raw = voice.trim() || chat.trim() || text;
  return sanitizeSpeakableText(raw);
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
      return sanitizeSpeakableText(emit);
    }

    const inner = body.slice(0, closeIdx);
    const speakable = inner.slice(this.voiceEmitted);
    this.voiceEmitted = inner.length;
    this.voiceClosed = true;
    return sanitizeSpeakableText(speakable);
  }
}
